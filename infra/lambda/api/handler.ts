import { addressFromContractId, NodeProvider, web3 } from "@alephium/web3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { AuctionManager } from "../../../artifacts/artifacts/ts/AuctionManager";
import { Staker } from "../../../artifacts/artifacts/ts/Staker";
import { StakeManager } from "../../../artifacts/artifacts/ts/StakeManager";
import { AuctionPool } from "../../../artifacts/artifacts/ts/AuctionPool";
import { Bid } from "../../../artifacts/artifacts/ts/Bid";
import { Bidder } from "../../../artifacts/artifacts/ts/Bidder";
import { ListNode } from "../../../artifacts/artifacts/ts/ListNode";
import { Loan } from "../../../artifacts/artifacts/ts/Loan";
import { LoanManager } from "../../../artifacts/artifacts/ts/LoanManager";
import { SortedList } from "../../../artifacts/artifacts/ts/SortedList";
import { formatAmount2 } from "../shared/format-amount";
import { formatInterestRate } from "../shared/interest-rate";
import { fetchOraclePrices } from "../shared/oracle-price";
import { getLatestPrices } from "../shared/price-store";
import { loadMainnetDeployments } from "../watcher/load-deployments";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
const PRICES_TABLE_NAME = process.env.PRICES_TABLE_NAME;
const LIQUIDATIONS_TABLE_NAME = process.env.LIQUIDATIONS_TABLE_NAME;
const BIDS_TABLE_NAME = process.env.BIDS_TABLE_NAME;
const STAKERS_TABLE_NAME = process.env.STAKERS_TABLE_NAME;
const TOKEN_STATS_TABLE_NAME = process.env.TOKEN_STATS_TABLE_NAME;
const NODE_URL = process.env.NODE_URL ?? "https://node.mainnet.alphscan.io";

const SCALE = 10n ** 18n;
const ABD_DECIMALS = 9;
// Cursor row PK stored in the liquidations table
const CURSOR_PK = "__cursor__";

function getCrZone(cr: bigint): string {
  const oneE18 = 10n ** 18n;
  if (cr < oneE18) return "Undercollateralized";
  if (cr < (11n * oneE18) / 10n) return "Auction";
  if (cr < (15n * oneE18) / 10n) return "Risky";
  return "Active";
}

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

function isLoanItem(item: Record<string, unknown>): boolean {
  return typeof item.owner === "string" && typeof item.collateral === "string";
}

async function fetchAllLoans(): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...((result.Items ?? []) as Record<string, unknown>[]));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items.filter(isLoanItem);
}

async function handleLoans(): Promise<APIGatewayProxyResultV2> {
  const loans = await fetchAllLoans();

  loans.sort((a, b) => {
    const debtA = parseFloat(String(a.debt ?? "0")) || 0;
    const debtB = parseFloat(String(b.debt ?? "0")) || 0;
    return debtB - debtA;
  });

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ loans, total: loans.length }),
  };
}

async function handlePrice(): Promise<APIGatewayProxyResultV2> {
  if (PRICES_TABLE_NAME) {
    const stored = await getLatestPrices(dynamo, PRICES_TABLE_NAME);
    if (stored.abdUsd && stored.alphUsd) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          abdUsd: stored.abdUsd,
          alphUsd: stored.alphUsd,
          recordedAt: stored.recordedAt,
          source: "dynamodb",
        }),
      };
    }
  }

  const prices = await fetchOraclePrices();
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      ...prices,
      recordedAt: new Date().toISOString(),
      source: "oracle",
    }),
  };
}

async function handleLoanByOwner(
  ownerAddress: string,
): Promise<APIGatewayProxyResultV2> {
  // Fast path: check DynamoDB first (watcher has already indexed this loan).
  const scanResult = await dynamo.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "#owner = :o",
      ExpressionAttributeNames: { "#owner": "owner" },
      ExpressionAttributeValues: { ":o": ownerAddress },
    }),
  );

  const existing = (scanResult.Items ?? []).find(isLoanItem);
  if (existing) {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(existing),
    };
  }

  // Fallback: query the chain directly via LoanManager.getLoanId(owner).
  // This mirrors exmaples/loan-by-owner.ts and finds loans that the watcher
  // may have missed due to broken SortedList links.
  try {
    web3.setCurrentNodeProvider(new NodeProvider(NODE_URL));

    const deployments = loadMainnetDeployments();
    const loanManagerContract = LoanManager.at(
      deployments.contracts.LoanManager.contractInstance.address,
    );

    let loanId: string;
    try {
      const result = await loanManagerContract.view.getLoanId({
        args: { owner: ownerAddress },
      });
      loanId = result.returns as string;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("5004") || msg.toLowerCase().includes("not exist")) {
        return {
          statusCode: 404,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: "No loan found for this address" }),
        };
      }
      throw e;
    }

    const loanAddress = addressFromContractId(loanId);
    const loanState = await Loan.at(loanAddress).fetchState();
    const { owner, collateral, debt, debtDecimals, interestRate } = loanState.fields;

    const allInterestRates = (
      await loanManagerContract.view.getAllInterestRates()
    ).returns as bigint[];

    const debtNorm =
      debtDecimals !== 0n ? (debt * SCALE) / 10n ** debtDecimals : debt;
    const cr =
      debtNorm > 0n ? (collateral * SCALE) / debtNorm : 999n * SCALE;

    const loan = {
      loanAddress,
      owner: owner as string,
      collateral: formatAmount2(collateral as bigint, 18),
      debt: formatAmount2(debt as bigint, Number(debtDecimals as bigint)),
      interestRate: formatInterestRate(interestRate as bigint, allInterestRates),
      crZone: getCrZone(cr),
      lastUpdated: new Date().toISOString(),
    };

    // Persist so the main /loans list picks it up on next scan
    await dynamo.send(
      new PutCommand({ TableName: TABLE_NAME, Item: loan }),
    ).catch((e) => console.warn("handleLoanByOwner write-on-read failed:", e));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(loan),
    };
  } catch (err) {
    console.error("handleLoanByOwner chain fallback error:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Failed to fetch loan from chain" }),
    };
  }
}

/** Aggregate per-wallet ABD totals from the abx-bids table (fast DynamoDB scan). */
const STATS_PK = "__stats__";

type BidderStat = { wallet: string; abdTotal: string; percent: number };
type BidderSummary = { openCount: number; filledCount: number; canceledCount: number };

/** Read the pre-computed summary counts from the __stats__ record (single GetCommand). */
async function readBidderSummary(): Promise<BidderSummary> {
  if (!BIDS_TABLE_NAME) return { openCount: 0, filledCount: 0, canceledCount: 0 };
  try {
    const result = await dynamo.send(
      new GetCommand({ TableName: BIDS_TABLE_NAME, Key: { bid: STATS_PK } }),
    );
    const item = result.Item;
    if (!item) return { openCount: 0, filledCount: 0, canceledCount: 0 };
    return {
      openCount: (item.openCount as number) ?? 0,
      filledCount: (item.filledCount as number) ?? 0,
      canceledCount: (item.canceledCount as number) ?? 0,
    };
  } catch {
    return { openCount: 0, filledCount: 0, canceledCount: 0 };
  }
}

type UserBidPosition = {
  bidAddress: string;
  discountPercent: number;
  abdAmount: string;
  bidStatus: string;
  bidIndex?: string;
  recordedAt: string;
};

/** Return all bids owned by a wallet (for the auction "Your Positions" panel). */
async function handleAuctionPositions(
  wallet: string,
): Promise<APIGatewayProxyResultV2> {
  if (!BIDS_TABLE_NAME) {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ positions: [], total: 0 }),
    };
  }

  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: BIDS_TABLE_NAME,
        FilterExpression: "bidOwner = :w AND attribute_exists(bidStatus)",
        ExpressionAttributeValues: { ":w": wallet },
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...((result.Items ?? []) as Record<string, unknown>[]));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  const positions: UserBidPosition[] = items
    .filter((item) => {
      const bid = item.bid;
      return typeof bid === "string" && !bid.startsWith("__");
    })
    .map((item) => ({
      bidAddress: item.bid as string,
      discountPercent: item.discountPercent as number,
      abdAmount: item.abdAmount as string,
      bidStatus: item.bidStatus as string,
      bidIndex: item.bidIndex !== undefined ? String(item.bidIndex) : undefined,
      recordedAt: item.recordedAt as string,
    }))
    .sort(
      (a, b) =>
        new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
    );

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ positions, total: positions.length }),
  };
}

/** Lazy per-status bidder scan — called only when the user opens a filter tab. */
async function handleAuctionBidders(
  status: string,
): Promise<APIGatewayProxyResultV2> {
  const validStatus = ["open", "completed", "canceled"];
  // "filled" is the display name for "completed"
  const dbStatus = status === "filled" ? "completed" : status;
  if (!validStatus.includes(dbStatus)) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Invalid status" }) };
  }
  if (!BIDS_TABLE_NAME) {
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ bidders: [] }) };
  }

  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: BIDS_TABLE_NAME,
        FilterExpression: "attribute_exists(bidOwner) AND bidStatus = :s",
        ExpressionAttributeValues: { ":s": dbStatus },
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...((result.Items ?? []) as Record<string, unknown>[]));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  // Aggregate per wallet
  const totals = new Map<string, number>();
  for (const item of items) {
    const wallet = item.bidOwner as string;
    const amount = parseFloat(item.abdAmount as string) || 0;
    totals.set(wallet, (totals.get(wallet) ?? 0) + amount);
  }
  const grandTotal = Array.from(totals.values()).reduce((a, b) => a + b, 0);
  const bidders: BidderStat[] = Array.from(totals.entries())
    .map(([wallet, abdTotal]) => ({
      wallet,
      abdTotal: abdTotal.toFixed(2),
      percent: grandTotal > 0 ? Math.round((abdTotal / grandTotal) * 1000) / 10 : 0,
    }))
    .sort((a, b) => parseFloat(b.abdTotal) - parseFloat(a.abdTotal));

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ bidders }),
  };
}

async function handleAuctions(): Promise<APIGatewayProxyResultV2> {
  web3.setCurrentNodeProvider(new NodeProvider(NODE_URL));
  const deployments = loadMainnetDeployments();
  const auctionManager = deployments.contracts.AuctionManager.contractInstance;

  const discountsResult = await auctionManager.view.getAllDiscounts();
  const discounts = Array.from(discountsResult.returns as [bigint, bigint, bigint, bigint]);

  // Fetch all pool summaries + bidder summary counts in parallel
  const [pools, bidderSummary] = await Promise.all([
    Promise.all(
      discounts.map(async (discount) => {
        const poolIdResult = await auctionManager.view.getAuctionPoolId({ args: { discount } });
        const poolAddress = addressFromContractId(poolIdResult.returns as string);
        const poolState = await AuctionPool.at(poolAddress).fetchState();
        const { bidsList, totalAbdAmount } = poolState.fields;

        let bidCount = 0;
        if (bidsList !== "" && (totalAbdAmount as bigint) > 0n) {
          const listState = await SortedList.at(addressFromContractId(bidsList as string)).fetchState();
          bidCount = Number(listState.fields.size as bigint);
        }

        return {
          discount: discount.toString(),
          discountPercent: Number(discount),
          totalAbdAmount: formatAmount2(totalAbdAmount as bigint, ABD_DECIMALS),
          bidCount,
          bids: [],
        };
      }),
    ),
    readBidderSummary(),
  ]);

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ pools, bidderSummary }),
  };
}

async function handleAuctionPoolBids(
  discountParam: string,
): Promise<APIGatewayProxyResultV2> {
  const discount = BigInt(discountParam);

  web3.setCurrentNodeProvider(new NodeProvider(NODE_URL));
  const deployments = loadMainnetDeployments();
  const auctionManager = deployments.contracts.AuctionManager.contractInstance;

  const poolIdResult = await auctionManager.view.getAuctionPoolId({ args: { discount } });
  const poolAddress = addressFromContractId(poolIdResult.returns as string);
  const poolState = await AuctionPool.at(poolAddress).fetchState();
  const { bidsList, totalAbdAmount } = poolState.fields;

  if (bidsList === "" || (totalAbdAmount as bigint) === 0n) {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ bids: [] }),
    };
  }

  const sortedList = SortedList.at(addressFromContractId(bidsList as string));
  const listState = await sortedList.fetchState();
  const { startNodeId, endNodeId, size } = listState.fields;

  // Collect all node IDs by walking the linked list.
  // endNodeId IS a real bid node (not a sentinel), so we push it before breaking.
  const nodeIds: string[] = [];
  let currentNodeId = startNodeId as string;
  const maxIter = Number(size as bigint) + 2;

  while (currentNodeId !== "" && nodeIds.length < maxIter) {
    nodeIds.push(currentNodeId);
    if (currentNodeId === (endNodeId as string)) break; // last real node — no need to walk further
    const nodeState = await ListNode.at(addressFromContractId(currentNodeId)).fetchState();
    currentNodeId = nodeState.fields.nextId as string;
  }

  // Fetch all bids in parallel; skip any whose contract was already destroyed
  const bidResults = await Promise.all(
    nodeIds.map(async (nodeId) => {
      try {
        const nodeState = await ListNode.at(addressFromContractId(nodeId)).fetchState();
        const bidAddress = addressFromContractId(nodeState.fields.contractId as string);
        const bidState = await Bid.at(bidAddress).fetchState();
        const { amount, creationTimestamp, bidderId } = bidState.fields;
        const bidderContractAddress = addressFromContractId(bidderId as string);
        const bidderState = await Bidder.at(bidderContractAddress).fetchState();
        return {
          bidAddress,
          bidderContractAddress,
          bidderWallet: bidderState.fields.owner as string,
          abdAmount: formatAmount2(amount as bigint, ABD_DECIMALS),
          createdAt: (creationTimestamp as bigint).toString(),
        };
      } catch {
        return null;
      }
    }),
  );

  const bids = bidResults.filter((b): b is NonNullable<typeof b> => b !== null);

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ bids }),
  };
}

async function handleLiquidations(): Promise<APIGatewayProxyResultV2> {
  if (!LIQUIDATIONS_TABLE_NAME) {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ liquidations: [], total: 0 }),
    };
  }

  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: LIQUIDATIONS_TABLE_NAME,
        FilterExpression: "txId <> :cursor",
        ExpressionAttributeValues: { ":cursor": CURSOR_PK },
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...((result.Items ?? []) as Record<string, unknown>[]));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  items.sort((a, b) => {
    const ta = (a.timestamp as number) ?? 0;
    const tb = (b.timestamp as number) ?? 0;
    return tb - ta;
  });

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ liquidations: items, total: items.length }),
  };
}

const STAKERS_STATS_PK = "__stats__";

type StakingPosition = {
  stakerContract: string;
  ownerAddress: string;
  stakedAbx: string;
  lockedAbx: string;
  withdrawableAbx: string;
  withdrawableAfterUnlockAbx: string;
  nextUnlockAt: string | null;
  lockCount: number;
  status: "active" | "vesting" | "withdrawable";
  claimableAlph: string;
  totalEarnedAlph: string;
  lastUpdated: string;
};

type StakingSummary = {
  totalStakers: number;
  totalStakedAbx: string;
  totalLockedAbx: string;
  totalWithdrawableAbx: string;
  updatedAt?: string;
};

async function handleStakers(): Promise<APIGatewayProxyResultV2> {
  if (!STAKERS_TABLE_NAME) {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ stakers: [], total: 0, summary: null }),
    };
  }

  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: STAKERS_TABLE_NAME,
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...((result.Items ?? []) as Record<string, unknown>[]));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  const statsItem = items.find((i) => i.stakerContract === STAKERS_STATS_PK);
  const summary: StakingSummary | null = statsItem
    ? {
        totalStakers: (statsItem.totalStakers as number) ?? 0,
        totalStakedAbx: (statsItem.totalStakedAbx as string) ?? "0",
        totalLockedAbx: (statsItem.totalLockedAbx as string) ?? "0",
        totalWithdrawableAbx: (statsItem.totalWithdrawableAbx as string) ?? "0",
        updatedAt: statsItem.updatedAt as string | undefined,
      }
    : null;

  const stakers: StakingPosition[] = items
    .filter((i) => {
      const pk = i.stakerContract as string;
      return typeof pk === "string" && !pk.startsWith("__") && typeof i.ownerAddress === "string";
    })
    .map((i) => ({
      stakerContract: i.stakerContract as string,
      ownerAddress: i.ownerAddress as string,
      stakedAbx: (i.stakedAbx as string) ?? "0",
      lockedAbx: (i.lockedAbx as string) ?? "0",
      withdrawableAbx: (i.withdrawableAbx as string) ?? "0",
      withdrawableAfterUnlockAbx: (i.withdrawableAfterUnlockAbx as string) ?? "0",
      nextUnlockAt: (i.nextUnlockAt as string | null) ?? null,
      lockCount: (i.lockCount as number) ?? 0,
      status: (i.status as StakingPosition["status"]) ?? "active",
      claimableAlph: (i.claimableAlph as string) ?? "0",
      totalEarnedAlph: (i.totalEarnedAlph as string) ?? "0",
      lastUpdated: (i.lastUpdated as string) ?? "",
    }))
    .sort((a, b) => (parseFloat(b.stakedAbx) || 0) - (parseFloat(a.stakedAbx) || 0));

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ stakers, total: stakers.length, summary }),
  };
}

async function handleStakerByOwner(wallet: string): Promise<APIGatewayProxyResultV2> {
  if (!STAKERS_TABLE_NAME) {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ positions: [] }),
    };
  }

  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: STAKERS_TABLE_NAME,
        FilterExpression: "ownerAddress = :w",
        ExpressionAttributeValues: { ":w": wallet },
        ExclusiveStartKey: lastKey,
      }),
    );
    items.push(...((result.Items ?? []) as Record<string, unknown>[]));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  const positions: StakingPosition[] = items
    .filter((i) => typeof (i.stakerContract as string) === "string" && !(i.stakerContract as string).startsWith("__"))
    .map((i) => ({
      stakerContract: i.stakerContract as string,
      ownerAddress: i.ownerAddress as string,
      stakedAbx: (i.stakedAbx as string) ?? "0",
      lockedAbx: (i.lockedAbx as string) ?? "0",
      withdrawableAbx: (i.withdrawableAbx as string) ?? "0",
      withdrawableAfterUnlockAbx: (i.withdrawableAfterUnlockAbx as string) ?? "0",
      nextUnlockAt: (i.nextUnlockAt as string | null) ?? null,
      lockCount: (i.lockCount as number) ?? 0,
      status: (i.status as StakingPosition["status"]) ?? "active",
      claimableAlph: (i.claimableAlph as string) ?? "0",
      totalEarnedAlph: (i.totalEarnedAlph as string) ?? "0",
      lastUpdated: (i.lastUpdated as string) ?? "",
    }));

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ positions }),
  };
}

const ABX_DECIMALS_STAKER = 9;
const ALPH_DECIMALS_STAKER = 18;

function deriveStakerStatusApi(
  lockedAbx: string,
  withdrawableAbx: string,
  nextUnlockAt: string | null,
): "active" | "vesting" | "withdrawable" {
  const locked = parseFloat(lockedAbx) || 0;
  const withdrawable = parseFloat(withdrawableAbx) || 0;
  if (withdrawable > 0) return "withdrawable";
  if (locked > 0) {
    if (!nextUnlockAt || new Date(nextUnlockAt).getTime() <= Date.now()) return "withdrawable";
    return "vesting";
  }
  return "active";
}

/**
 * POST /stakers/reindex
 * Body: { wallet: string }
 * Fetches the staking position live from the chain for the given wallet,
 * writes it to DynamoDB, and returns the fresh position.
 * Much safer than a PUT — the server owns the data, not the client.
 */
async function handleReindexStaker(body: string | null): Promise<APIGatewayProxyResultV2> {
  if (!STAKERS_TABLE_NAME) {
    return { statusCode: 503, headers: CORS_HEADERS, body: JSON.stringify({ error: "Stakers table not configured" }) };
  }

  let wallet: string;
  try {
    const parsed = JSON.parse(body ?? "{}");
    wallet = parsed.wallet;
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  if (!wallet || typeof wallet !== "string") {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "wallet is required" }) };
  }

  web3.setCurrentNodeProvider(new NodeProvider(NODE_URL));

  const deployments = loadMainnetDeployments();
  const mgr = StakeManager.at(deployments.contracts.StakeManager.contractInstance.address);

  // Resolve the wallet's Staker sub-contract
  let contractId: string;
  try {
    const res = await mgr.view.getStakerId({ args: { staker: wallet } });
    contractId = res.returns as string;
  } catch {
    return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: "No staker contract found for this wallet" }) };
  }

  if (!contractId) {
    return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: "No staker contract found for this wallet" }) };
  }

  const stakerAddr = addressFromContractId(contractId);
  const staker = Staker.at(stakerAddr);

  const [
    owner,
    staked,
    locked,
    withdrawable,
    afterUnlock,
    unlockTs,
    idxFrom,
    idxTo,
    claimableAtto,
    statsResult,
  ] = await Promise.all([
    staker.view.getStakerAddress().then((r) => r.returns as string),
    staker.view.getStakedAmount().then((r) => r.returns as bigint),
    staker.view.getLockedAmount().then((r) => r.returns as bigint),
    staker.view.getWithdrawableAmount().then((r) => r.returns as bigint),
    staker.view.getWithdrawableAfterUnlock().then((r) => r.returns as bigint),
    staker.view.getUnlockTimestamp().then((r) => r.returns as bigint),
    staker.view.getIndexFrom().then((r) => r.returns as bigint),
    staker.view.getIndexTo().then((r) => r.returns as bigint),
    staker.view.getReward().then((r) => r.returns as bigint),
    staker.view.getStatistics(),
  ]);

  const stakedAbx = formatAmount2(staked, ABX_DECIMALS_STAKER);
  const lockedAbx = formatAmount2(locked, ABX_DECIMALS_STAKER);
  const withdrawableAbx = formatAmount2(withdrawable, ABX_DECIMALS_STAKER);
  const withdrawableAfterUnlockAbx = formatAmount2(afterUnlock, ABX_DECIMALS_STAKER);
  const nextUnlockAt = unlockTs > 0n ? new Date(Number(unlockTs)).toISOString() : null;
  const lockCount = Number(idxTo - idxFrom);
  const status = deriveStakerStatusApi(lockedAbx, withdrawableAbx, nextUnlockAt);

  const claimableAlph = formatAmount2(claimableAtto, ALPH_DECIMALS_STAKER);
  const totalEarnedAtto = (statsResult.returns as { totalRewarded: bigint }).totalRewarded;
  const totalEarnedAlph = formatAmount2(totalEarnedAtto, ALPH_DECIMALS_STAKER);
  const lastUpdated = new Date().toISOString();

  const item = {
    stakerContract: stakerAddr,
    ownerAddress: owner,
    stakedAbx, lockedAbx, withdrawableAbx, withdrawableAfterUnlockAbx,
    nextUnlockAt, lockCount, status,
    claimableAlph, totalEarnedAlph, lastUpdated,
  };

  await dynamo.send(new PutCommand({ TableName: STAKERS_TABLE_NAME, Item: item }));

  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ position: item }) };
}

/**
 * POST /loans/index
 * Body: { owner?: string; loanAddress?: string }
 * Fetches the loan on-chain and upserts it to DynamoDB.
 * Useful for indexing loans missed by the SortedList traversal.
 */
async function handleIndexLoan(body: string | null): Promise<APIGatewayProxyResultV2> {
  let owner: string | undefined;
  let loanAddress: string | undefined;

  try {
    const parsed = JSON.parse(body ?? "{}");
    owner = parsed.owner;
    loanAddress = parsed.loanAddress;
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  if (!owner && !loanAddress) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Provide owner or loanAddress" }),
    };
  }

  try {
    web3.setCurrentNodeProvider(new NodeProvider(NODE_URL));
    const deployments = loadMainnetDeployments();
    const loanManagerContract = LoanManager.at(
      deployments.contracts.LoanManager.contractInstance.address,
    );
    const allInterestRates = (
      await loanManagerContract.view.getAllInterestRates()
    ).returns as bigint[];

    // Resolve loanAddress if only owner was given
    if (!loanAddress) {
      const result = await loanManagerContract.view.getLoanId({
        args: { owner: owner! },
      });
      loanAddress = addressFromContractId(result.returns as string);
    }

    const loanState = await Loan.at(loanAddress).fetchState();
    const { owner: loanOwner, collateral, debt, debtDecimals, interestRate } = loanState.fields;

    const debtNorm =
      (debtDecimals as bigint) !== 0n
        ? ((debt as bigint) * SCALE) / 10n ** (debtDecimals as bigint)
        : (debt as bigint);
    const cr =
      debtNorm > 0n ? ((collateral as bigint) * SCALE) / debtNorm : 999n * SCALE;

    const loan = {
      loanAddress,
      owner: loanOwner as string,
      collateral: formatAmount2(collateral as bigint, 18),
      debt: formatAmount2(debt as bigint, Number(debtDecimals as bigint)),
      interestRate: formatInterestRate(interestRate as bigint, allInterestRates),
      crZone: getCrZone(cr),
      lastUpdated: new Date().toISOString(),
    };

    await dynamo.send(new PutCommand({ TableName: TABLE_NAME, Item: loan }));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ ...loan, indexed: true }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("5004") || msg.toLowerCase().includes("not exist")) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Loan not found on-chain" }),
      };
    }
    console.error("handleIndexLoan error:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Failed to index loan" }),
    };
  }
}

async function handleTokenStats(): Promise<APIGatewayProxyResultV2> {
  if (!TOKEN_STATS_TABLE_NAME) {
    return {
      statusCode: 503,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Token stats not available" }),
    };
  }

  const result = await dynamo.send(
    new GetCommand({ TableName: TOKEN_STATS_TABLE_NAME, Key: { pk: "__latest__" } }),
  );

  if (!result.Item) {
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Token stats not yet indexed" }),
    };
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(result.Item),
  };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const path = event.rawPath ?? event.requestContext.http.path;
  const method = event.requestContext.http.method.toUpperCase();

  const byOwnerMatch = path.match(/\/loans\/by-owner\/([^/?]+)/);
  const auctionBidsMatch = path.match(/\/auctions\/(\d+)\/bids$/);
  const auctionBiddersMatch = path.match(/\/auctions\/bidders$/);
  const auctionPositionsMatch = path.match(/\/auctions\/positions\/([^/?]+)$/);
  const stakerByOwnerMatch = path.match(/\/stakers\/by-owner\/([^/?]+)$/);

  try {
    if (path === "/token-stats" || path.endsWith("/token-stats")) {
      return await handleTokenStats();
    }
    if (path === "/price" || path.endsWith("/price")) {
      return await handlePrice();
    }
    if (auctionBidsMatch) {
      return await handleAuctionPoolBids(auctionBidsMatch[1]);
    }
    if (auctionBiddersMatch) {
      const statusParam = (event.queryStringParameters?.status ?? "open") as string;
      return await handleAuctionBidders(statusParam);
    }
    if (auctionPositionsMatch) {
      return await handleAuctionPositions(
        decodeURIComponent(auctionPositionsMatch[1]),
      );
    }
    if (path === "/auctions" || path.endsWith("/auctions")) {
      return await handleAuctions();
    }
    if (path === "/liquidations" || path.endsWith("/liquidations")) {
      return await handleLiquidations();
    }
    if ((path === "/loans/index" || path.endsWith("/loans/index")) && method === "POST") {
      return await handleIndexLoan(event.body ?? null);
    }
    if ((path === "/stakers/reindex" || path.endsWith("/stakers/reindex")) && method === "POST") {
      return await handleReindexStaker(event.body ?? null);
    }
    if (byOwnerMatch) {
      return await handleLoanByOwner(decodeURIComponent(byOwnerMatch[1]));
    }
    if (stakerByOwnerMatch) {
      return await handleStakerByOwner(decodeURIComponent(stakerByOwnerMatch[1]));
    }
    if (path === "/stakers" || path.endsWith("/stakers")) {
      return await handleStakers();
    }
    return await handleLoans();
  } catch (err) {
    console.error(`Error handling ${path}:`, err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
}
