/**
 * Watcher Lambda — triggered every 5 minutes by EventBridge.
 * Traverses the AlphBanx SortedList on-chain to collect all open loans,
 * then bulk-upserts them into DynamoDB.
 */
import { addressFromContractId, getSenderAddress, NodeProvider, web3 } from "@alephium/web3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand, DeleteCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { AbdToken } from "../../../artifacts/artifacts/ts/AbdToken";
import { AuctionManager } from "../../../artifacts/artifacts/ts/AuctionManager";
import { AuctionPool } from "../../../artifacts/artifacts/ts/AuctionPool";
import { LockInfo } from "../../../artifacts/artifacts/ts/LockInfo";
import { Loan } from "../../../artifacts/artifacts/ts/Loan";
import { LoanManager } from "../../../artifacts/artifacts/ts/LoanManager";
import { SortedList } from "../../../artifacts/artifacts/ts/SortedList";
import { Staker } from "../../../artifacts/artifacts/ts/Staker";
import { formatAmount2 } from "../shared/format-amount";
import { formatInterestRate } from "../shared/interest-rate";
import { fetchOraclePrices } from "../shared/oracle-price";
import { savePriceHistory } from "../shared/price-store";
import { collectLoanContractIds } from "../shared/traverse-loans";
import { loadMainnetDeployments } from "./load-deployments";
import treasuryConfig from "../../config/treasury.json";

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
// ABX token has 9 decimals: issueTokenAmount=10^17 / 10^9 = 100M ABX total supply
const ABX_DECIMALS = 9;

// AuctionManager event indices
const NEW_BID_EVENT_INDEX = 3;
const CANCEL_BID_EVENT_INDEX = 4;
const LIQUIDATION_EVENT_INDEX = 5;
const BID_WIN_EVENT_INDEX = 6;
const BID_PARTIAL_WIN_EVENT_INDEX = 7;
// BorrowerOperationsV2 event indices
const OPEN_LOAN_EVENT_INDEX = 0;
// Cursor row PK stored in both the liquidations and bids tables
const CURSOR_PK = "__cursor__";
// Stats summary row PK stored in the bids table
const STATS_PK = "__stats__";
// Cursor row PK for BorrowerOperations event scanner (stored in loans table)
const BO_CURSOR_PK = "__bo_cursor__";

function getCrZone(cr: bigint): string {
  const oneE18 = 10n ** 18n;
  if (cr < oneE18) return "Undercollateralized";
  if (cr < 11n * oneE18 / 10n) return "Auction";
  if (cr < 15n * oneE18 / 10n) return "Risky";
  return "Active";
}

async function removeStaleLoans(
  activeAddresses: Set<string>,
  traversalComplete: boolean,
): Promise<number> {
  let removed = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        ProjectionExpression: "loanAddress",
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of result.Items ?? []) {
      const addr = item.loanAddress as string;
      if (activeAddresses.has(addr)) continue;

      if (!traversalComplete) {
        // Traversal missed some loans — verify on-chain before deleting to avoid
        // removing a valid loan that broken list links prevented us from reaching.
        try {
          await Loan.at(addr).fetchState();
          // Contract still exists: keep it in DynamoDB.
          console.log(`[Watcher] Traversal incomplete — keeping ${addr} (contract still live)`);
          continue;
        } catch {
          // Contract gone: safe to delete.
        }
      }

      await dynamo.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { loanAddress: addr },
        }),
      );
      removed++;
    }

    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return removed;
}

/** Look up the discount % for a bid address from the abx-bids table. */
async function getBidDiscount(bidAddress: string): Promise<number | null> {
  if (!BIDS_TABLE_NAME) return null;
  try {
    const result = await dynamo.send(
      new GetCommand({ TableName: BIDS_TABLE_NAME, Key: { bid: bidAddress } }),
    );
    if (!result.Item) return null;
    return (result.Item.discountPercent as number) ?? null;
  } catch {
    return null;
  }
}

/** Fetch the address that signed/triggered a transaction. */
async function getLiquidatorFromTx(
  nodeProvider: NodeProvider,
  txId: string,
): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = await (nodeProvider as any).transactions.getTransactionsDetailsTxid(txId);
    return getSenderAddress(tx);
  } catch {
    return null;
  }
}

/**
 * Index NewBid events into the abx-bids table so that, when a BidWin fires,
 * we can look up the discount % for the winning bid.  Uses its own cursor
 * stored in the bids table (starts at 0 on first deploy to capture all
 * historical bids).
 */
async function trackBidEvents(
  nodeProvider: NodeProvider,
  auctionManagerAddress: string,
): Promise<void> {
  if (!BIDS_TABLE_NAME) return;

  const cursorResult = await dynamo.send(
    new GetCommand({ TableName: BIDS_TABLE_NAME, Key: { bid: CURSOR_PK } }),
  );
  const cursor: number = (cursorResult.Item?.nextStart as number | undefined) ?? 0;

  const currentCount =
    await nodeProvider.events.getEventsContractContractaddressCurrentCount(auctionManagerAddress);
  if (currentCount <= cursor) return;

  const result = await nodeProvider.events.getEventsContractContractaddress(
    auctionManagerAddress,
    { start: cursor, limit: 100 },
  );

  let stored = 0;
  for (const event of result.events) {
    if (
      event.eventIndex !== NEW_BID_EVENT_INDEX &&
      event.eventIndex !== CANCEL_BID_EVENT_INDEX &&
      event.eventIndex !== BID_WIN_EVENT_INDEX &&
      event.eventIndex !== BID_PARTIAL_WIN_EVENT_INDEX
    ) continue;

    const fields = event.fields;

    if (event.eventIndex === NEW_BID_EVENT_INDEX) {
      // NewBid: [bid, bidder, owner, abdAmount, discount, index]
      const bid = (fields[0] as { value: string }).value;
      const bidOwner = (fields[2] as { value: string }).value;
      const abdAmountRaw = (fields[3] as { value: string }).value;
      const discountRaw = (fields[4] as { value: string }).value;
      const abdAmount = formatAmount2(BigInt(abdAmountRaw), ABD_DECIMALS);
      const discountPercent = Number(BigInt(discountRaw));
      const bidIndex = (fields[5] as { value: string }).value;

      try {
        await dynamo.send(
          new PutCommand({
            TableName: BIDS_TABLE_NAME,
            Item: {
              bid,
              bidOwner,
              abdAmount,
              discountPercent,
              bidIndex,
              bidStatus: "open",
              recordedAt: new Date().toISOString(),
            },
            ConditionExpression: "attribute_not_exists(bid)",
          }),
        );
        stored++;
      } catch {
        // Already indexed — skip
      }
    } else if (event.eventIndex === CANCEL_BID_EVENT_INDEX) {
      // CancelBid: [bid, bidder, owner, abdAmount]
      const bid = (fields[0] as { value: string }).value;
      await dynamo.send(
        new UpdateCommand({
          TableName: BIDS_TABLE_NAME,
          Key: { bid },
          UpdateExpression: "SET bidStatus = :s",
          ExpressionAttributeValues: { ":s": "canceled" },
        }),
      ).catch(() => {/* ignore if not found */});
    } else if (event.eventIndex === BID_WIN_EVENT_INDEX) {
      // BidWin: bid fully consumed — mark completed so bidder stats filter excludes it,
      // but keep the record so discount lookups still work for the matching Liquidation event.
      const bid = (fields[0] as { value: string }).value;
      await dynamo.send(
        new UpdateCommand({
          TableName: BIDS_TABLE_NAME,
          Key: { bid },
          UpdateExpression: "SET bidStatus = :s",
          ExpressionAttributeValues: { ":s": "completed" },
        }),
      ).catch(() => {/* ignore if not found */});
    } else if (event.eventIndex === BID_PARTIAL_WIN_EVENT_INDEX) {
      // BidPartialWin: [bid, bidder, owner, loan, abdAmount, remainingAbd, reward]
      const bid = (fields[0] as { value: string }).value;
      const remainingRaw = (fields[5] as { value: string }).value;
      const abdAmount = formatAmount2(BigInt(remainingRaw), ABD_DECIMALS);
      await dynamo.send(
        new UpdateCommand({
          TableName: BIDS_TABLE_NAME,
          Key: { bid },
          UpdateExpression: "SET abdAmount = :a",
          ExpressionAttributeValues: { ":a": abdAmount },
        }),
      ).catch(() => {/* ignore if bid not found */});
    }
  }

  await dynamo.send(
    new PutCommand({
      TableName: BIDS_TABLE_NAME,
      Item: { bid: CURSOR_PK, nextStart: result.nextStart, updatedAt: new Date().toISOString() },
    }),
  );

  // Keep the stats record in sync after each batch
  await updateBidStats();

  console.log(`[Watcher] Bids cursor advanced to ${result.nextStart} (${stored} new bids)`);
}

/** Count bids by status and write a __stats__ summary record to the bids table. */
async function updateBidStats(): Promise<void> {
  if (!BIDS_TABLE_NAME) return;

  async function countByStatus(status: string): Promise<number> {
    let count = 0;
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await dynamo.send(
        new ScanCommand({
          TableName: BIDS_TABLE_NAME,
          FilterExpression: "bidStatus = :s",
          ExpressionAttributeValues: { ":s": status },
          Select: "COUNT",
          ExclusiveStartKey: lastKey,
        }),
      );
      count += res.Count ?? 0;
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);
    return count;
  }

  const [openCount, filledCount, canceledCount] = await Promise.all([
    countByStatus("open"),
    countByStatus("completed"),
    countByStatus("canceled"),
  ]);

  await dynamo.send(
    new PutCommand({
      TableName: BIDS_TABLE_NAME,
      Item: { bid: STATS_PK, openCount, filledCount, canceledCount, updatedAt: new Date().toISOString() },
    }),
  );
}

async function trackLiquidationEvents(
  nodeProvider: NodeProvider,
  auctionManagerAddress: string,
): Promise<void> {
  if (!LIQUIDATIONS_TABLE_NAME) return;

  // Read last processed event counter from DynamoDB
  const cursorResult = await dynamo.send(
    new GetCommand({
      TableName: LIQUIDATIONS_TABLE_NAME,
      Key: { txId: CURSOR_PK },
    }),
  );
  const cursor: number = (cursorResult.Item?.nextStart as number | undefined) ?? 0;

  // Get current total event count to know if there is anything new
  const currentCount = await nodeProvider.events.getEventsContractContractaddressCurrentCount(
    auctionManagerAddress,
  );

  if (currentCount <= cursor) {
    console.log(`[Watcher] Liquidation events: no new events (cursor=${cursor}, count=${currentCount})`);
    return;
  }

  const result = await nodeProvider.events.getEventsContractContractaddress(
    auctionManagerAddress,
    { start: cursor, limit: 100 },
  );

  // Build a txId → BidWin/BidPartialWin data map for enriching liquidation records
  type BidWinData = { bid: string; owner: string; abdAmount: bigint; reward: bigint };
  const bidWinByTxId = new Map<string, BidWinData[]>();

  for (const event of result.events) {
    if (
      event.eventIndex !== BID_WIN_EVENT_INDEX &&
      event.eventIndex !== BID_PARTIAL_WIN_EVENT_INDEX
    ) continue;

    const fields = event.fields;
    // BidWin:        [bid, bidder, owner, loan, abdAmount, reward]
    // BidPartialWin: [bid, bidder, owner, loan, abdAmount, remainingAbd, reward]
    const bid = (fields[0] as { value: string }).value;
    const owner = (fields[2] as { value: string }).value;
    const abdAmount = BigInt((fields[4] as { value: string }).value);
    const rewardFieldIdx = event.eventIndex === BID_WIN_EVENT_INDEX ? 5 : 6;
    const reward = BigInt((fields[rewardFieldIdx] as { value: string }).value);

    const list = bidWinByTxId.get(event.txId) ?? [];
    list.push({ bid, owner, abdAmount, reward });
    bidWinByTxId.set(event.txId, list);
  }

  const liquidationEvents = result.events.filter(
    (e) => e.eventIndex === LIQUIDATION_EVENT_INDEX,
  );

  console.log(
    `[Watcher] Liquidation events: fetched ${result.events.length} events, ${liquidationEvents.length} liquidations`,
  );

  for (const event of liquidationEvents) {
    const fields = event.fields;
    // LiquidationEvent: [loan: Address, loanOwner: Address, newCollateral: U256, newDebt: U256]
    const loan = (fields[0] as { value: string }).value;
    const loanOwner = (fields[1] as { value: string }).value;
    const newCollateral = (fields[2] as { value: string }).value;
    const newDebt = (fields[3] as { value: string }).value;

    // Enrich with BidWin data emitted in the same transaction
    const bidWins = bidWinByTxId.get(event.txId) ?? [];
    let auctionOwner: string | undefined;
    let totalAbdLiquidated = 0n;
    let totalAlphReward = 0n;
    let discountPercent: number | null = null;

    for (const bw of bidWins) {
      auctionOwner = bw.owner;
      totalAbdLiquidated += bw.abdAmount;
      totalAlphReward += bw.reward;
      if (discountPercent === null) {
        discountPercent = await getBidDiscount(bw.bid);
      }
    }

    const liquidator = await getLiquidatorFromTx(nodeProvider, event.txId);

    try {
      await dynamo.send(
        new PutCommand({
          TableName: LIQUIDATIONS_TABLE_NAME,
          Item: {
            txId: event.txId,
            loan,
            loanOwner,
            newCollateral: formatAmount2(BigInt(newCollateral), 18),
            newDebt: formatAmount2(BigInt(newDebt), 9),
            timestamp: event.timestamp,
            recordedAt: new Date().toISOString(),
            ...(auctionOwner !== undefined && { auctionOwner }),
            ...(totalAbdLiquidated > 0n && {
              abdLiquidated: formatAmount2(totalAbdLiquidated, 9),
            }),
            ...(totalAlphReward > 0n && {
              alphReward: formatAmount2(totalAlphReward, 18),
            }),
            ...(discountPercent !== null && { discount: discountPercent }),
            ...(liquidator !== null && { liquidator }),
          },
          ConditionExpression: "attribute_not_exists(txId)",
        }),
      );
    } catch {
      // Ignore ConditionalCheckFailedException — event already stored
    }
  }

  // Update cursor to resume from here next run
  await dynamo.send(
    new PutCommand({
      TableName: LIQUIDATIONS_TABLE_NAME,
      Item: {
        txId: CURSOR_PK,
        nextStart: result.nextStart,
        updatedAt: new Date().toISOString(),
      },
    }),
  );

  console.log(`[Watcher] Liquidation cursor advanced to ${result.nextStart}`);
}

/**
 * Scan BorrowerOperationsV2 OpenLoan events to discover loans that the
 * SortedList traversal may have missed due to broken list links.
 * Uses its own cursor stored as loanAddress="__bo_cursor__" in the loans table.
 */
async function trackBorrowerOperationsEvents(
  nodeProvider: NodeProvider,
  borrowerOpsAddress: string,
  allInterestRates: bigint[],
): Promise<void> {
  // Read cursor
  const cursorResult = await dynamo.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { loanAddress: BO_CURSOR_PK } }),
  );
  const cursor: number = (cursorResult.Item?.nextStart as number | undefined) ?? 0;

  const currentCount =
    await nodeProvider.events.getEventsContractContractaddressCurrentCount(borrowerOpsAddress);

  if (currentCount <= cursor) {
    console.log(`[Watcher] BorrowerOps events: up to date (cursor=${cursor})`);
    return;
  }

  const result = await nodeProvider.events.getEventsContractContractaddress(
    borrowerOpsAddress,
    { start: cursor, limit: 100 },
  );

  // Collect unique loan addresses from OpenLoan events
  const discoveredAddresses = new Set<string>();
  for (const event of result.events) {
    if (event.eventIndex !== OPEN_LOAN_EVENT_INDEX) continue;
    const loanAddress = (event.fields[0] as { value: string }).value;
    if (loanAddress) discoveredAddresses.add(loanAddress);
  }

  let added = 0;
  for (const loanAddress of discoveredAddresses) {
    // Skip if already indexed
    const existing = await dynamo.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { loanAddress } }),
    );
    if (existing.Item) continue;

    // Fetch on-chain state — skip if contract no longer exists (loan closed/liquidated)
    try {
      const loanState = await Loan.at(loanAddress).fetchState();
      const { owner, collateral, debt, debtDecimals, interestRate } = loanState.fields;

      const debtNorm = debtDecimals ? (debt as bigint) * SCALE / (10n ** (debtDecimals as bigint)) : (debt as bigint);
      const cr = debtNorm > 0n ? ((collateral as bigint) * SCALE) / debtNorm : 999n * SCALE;
      const crZone = getCrZone(cr);

      await dynamo.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            loanAddress,
            owner: owner as string,
            collateral: formatAmount2(collateral as bigint, 18),
            debt: formatAmount2(debt as bigint, Number(debtDecimals as bigint)),
            interestRate: formatInterestRate(interestRate as bigint, allInterestRates),
            crZone,
            lastUpdated: new Date().toISOString(),
          },
        }),
      );
      added++;
      console.log(`[Watcher] BorrowerOps: indexed previously missing loan ${loanAddress}`);
    } catch {
      // Contract destroyed — loan is closed/liquidated, skip
    }
  }

  // Advance cursor
  await dynamo.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        loanAddress: BO_CURSOR_PK,
        nextStart: result.nextStart,
        updatedAt: new Date().toISOString(),
      },
    }),
  );

  console.log(
    `[Watcher] BorrowerOps cursor advanced to ${result.nextStart} (${discoveredAddresses.size} loans seen, ${added} newly indexed)`,
  );
}

/** Paginate all sub-contracts of a parent contract address. */
async function fetchAllSubContracts(
  nodeProvider: NodeProvider,
  parentAddress: string,
  pageSize: number,
): Promise<string[]> {
  const out: string[] = [];
  let start = 0;
  for (;;) {
    const page = await nodeProvider.contracts.getContractsAddressSubContracts(
      parentAddress,
      { start, limit: pageSize },
    );
    if (page.subContracts.length === 0) break;
    out.push(...page.subContracts);
    const next = page.nextStart;
    if (next === undefined || next === start) break;
    start = next;
  }
  return [...new Set(out)];
}

function deriveStakerStatus(
  lockedAbx: string,
  withdrawableAbx: string,
  nextUnlockAt: string | null,
): "active" | "vesting" | "withdrawable" {
  const locked = parseFloat(lockedAbx) || 0;
  const withdrawable = parseFloat(withdrawableAbx) || 0;
  // Already moved through unlock tx — can claim immediately
  if (withdrawable > 0) return "withdrawable";
  if (locked > 0) {
    // Vesting period over: user must call unlock tx, but tokens are "ready"
    if (!nextUnlockAt || new Date(nextUnlockAt).getTime() <= Date.now()) return "withdrawable";
    // Still within vesting period
    return "vesting";
  }
  return "active";
}

// Minimum ALPH every Staker sub-contract must hold for on-chain storage.
const ALPH_DECIMALS = 18;

type StakerItem = {
  stakerContract: string;
  ownerAddress: string;
  stakedAbx: string;
  lockedAbx: string;
  withdrawableAbx: string;
  withdrawableAfterUnlockAbx: string;
  nextUnlockAt: string | null;
  lockCount: number;
  status: "active" | "vesting" | "withdrawable";
  claimableAlph: string;   // ALPH balance minus storage deposit
  totalEarnedAlph: string; // cumulative lifetime ALPH earned (statistics.totalRewarded)
  lastUpdated: string;
};

async function fetchStakerItem(addr: string): Promise<StakerItem | null> {
  const staker = Staker.at(addr);
  try {
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

    const stakedAbx = formatAmount2(staked, ABX_DECIMALS);
    const lockedAbx = formatAmount2(locked, ABX_DECIMALS);
    const withdrawableAbx = formatAmount2(withdrawable, ABX_DECIMALS);
    const withdrawableAfterUnlockAbx = formatAmount2(afterUnlock, ABX_DECIMALS);
    const nextUnlockAt = unlockTs > 0n ? new Date(Number(unlockTs)).toISOString() : null;
    const lockCount = Number(idxTo - idxFrom);
    const status = deriveStakerStatus(lockedAbx, withdrawableAbx, nextUnlockAt);

    const claimableAlph = formatAmount2(claimableAtto, ALPH_DECIMALS);
    const totalRewarded = (statsResult.returns as { totalRewarded: bigint }).totalRewarded;
    const totalEarnedAlph = formatAmount2(totalRewarded, ALPH_DECIMALS);

    return {
      stakerContract: addr,
      ownerAddress: owner,
      stakedAbx,
      lockedAbx,
      withdrawableAbx,
      withdrawableAfterUnlockAbx,
      nextUnlockAt,
      lockCount,
      status,
      claimableAlph,
      totalEarnedAlph,
      lastUpdated: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(`[Watcher] Stakers: failed to fetch ${addr}: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Quick three-field check: stakedAmount + lockedAmount + claimable reward.
 * Reward can change after any liquidation even when ABX amounts stay the same.
 * Returns [formattedStaked, formattedLocked, formattedClaimable], or null on error.
 */
async function quickCheckStaker(addr: string): Promise<[string, string, string] | null> {
  const staker = Staker.at(addr);
  try {
    const [staked, locked, reward] = await Promise.all([
      staker.view.getStakedAmount().then((r) => r.returns as bigint),
      staker.view.getLockedAmount().then((r) => r.returns as bigint),
      staker.view.getReward().then((r) => r.returns as bigint),
    ]);
    return [formatAmount2(staked, ABX_DECIMALS), formatAmount2(locked, ABX_DECIMALS), formatAmount2(reward, ALPH_DECIMALS)];
  } catch {
    return null;
  }
}

/** Scan all StakeManager sub-contracts and upsert staking positions to abx-stakers. */
async function trackStakerPositions(nodeProvider: NodeProvider): Promise<void> {
  if (!STAKERS_TABLE_NAME) return;

  const deployments = loadMainnetDeployments();
  const stakeManagerAddress = deployments.contracts.StakeManager.contractInstance.address;

  // Step 1: get current sub-contract addresses from the chain
  const addresses = await fetchAllSubContracts(nodeProvider, stakeManagerAddress, 80);
  console.log(`[Watcher] Stakers: found ${addresses.length} sub-contracts`);

  // Step 2: load all existing DDB records (used to detect changes & for stale cleanup)
  const existingMap = new Map<string, StakerItem>();
  {
    const STATS_PK_STAKERS = "__stats__";
    let scanKey: Record<string, unknown> | undefined;
    do {
      const res = await dynamo.send(
        new ScanCommand({ TableName: STAKERS_TABLE_NAME, ExclusiveStartKey: scanKey }),
      );
      for (const item of res.Items ?? []) {
        const pk = item.stakerContract as string;
        if (!pk || pk === STATS_PK_STAKERS) continue;
        existingMap.set(pk, item as unknown as StakerItem);
      }
      scanKey = res.LastEvaluatedKey;
    } while (scanKey);
  }

  const STATS_PK_STAKERS = "__stats__";
  const BATCH_SIZE = 20;
  const now = Date.now();

  // Classify addresses into those needing full fetch vs quick check
  const toFullFetch: string[] = [];
  const toQuickCheck: string[] = [];

  for (const addr of addresses) {
    const existing = existingMap.get(addr);
    if (!existing) {
      // New staker — always full fetch
      toFullFetch.push(addr);
      continue;
    }
    // Backfill: if new reward fields are absent, force a full fetch once
    if (!existing.claimableAlph || !existing.totalEarnedAlph) {
      toFullFetch.push(addr);
      continue;
    }
    // Re-derive status in case it's stale due to time passing
    const correctStatus = deriveStakerStatus(
      existing.lockedAbx,
      existing.withdrawableAbx,
      existing.nextUnlockAt,
    );
    if (correctStatus !== existing.status) {
      // Status changed purely by time (e.g. lock expired) — full fetch to refresh all fields
      toFullFetch.push(addr);
    } else {
      toQuickCheck.push(addr);
    }
  }

  // Step 3: quick check for stable positions (2 calls each instead of 8)
  const quickChangedAddrs: string[] = [];
  for (let i = 0; i < toQuickCheck.length; i += BATCH_SIZE) {
    const batch = toQuickCheck.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((addr) => quickCheckStaker(addr)));
    for (let j = 0; j < batch.length; j++) {
      const addr = batch[j];
      const check = results[j];
      const existing = existingMap.get(addr)!;
      if (
        check === null ||
        check[0] !== existing.stakedAbx ||
        check[1] !== existing.lockedAbx ||
        check[2] !== existing.claimableAlph
      ) {
        quickChangedAddrs.push(addr);
      }
    }
  }
  toFullFetch.push(...quickChangedAddrs);

  // Step 4: full fetch for new + changed positions
  const fullyFetched: StakerItem[] = [];
  for (let i = 0; i < toFullFetch.length; i += BATCH_SIZE) {
    const batch = toFullFetch.slice(i, i + BATCH_SIZE);
    const items = await Promise.all(batch.map((addr) => fetchStakerItem(addr)));
    for (const item of items) {
      if (item) fullyFetched.push(item);
    }
  }

  // Step 5: build final result map (existing + fully-fetched overrides)
  const activeContracts = new Set(addresses);
  const allItems: StakerItem[] = [];

  for (const addr of addresses) {
    const fetched = fullyFetched.find((x) => x.stakerContract === addr);
    if (fetched) {
      allItems.push(fetched);
    } else {
      const cached = existingMap.get(addr);
      if (cached) {
        // Recalculate status in case time changed it (e.g. lock expired)
        const updatedStatus = deriveStakerStatus(
          cached.lockedAbx,
          cached.withdrawableAbx,
          cached.nextUnlockAt,
        );
        allItems.push(updatedStatus !== cached.status ? { ...cached, status: updatedStatus } : cached);
      }
    }
  }

  // Step 6: DDB writes — only write items that changed (or are new)
  const toWrite = allItems.filter((item) => {
    const existing = existingMap.get(item.stakerContract);
    if (!existing) return true; // new
    return (
      item.stakedAbx !== existing.stakedAbx ||
      item.lockedAbx !== existing.lockedAbx ||
      item.withdrawableAbx !== existing.withdrawableAbx ||
      item.status !== existing.status ||
      item.claimableAlph !== existing.claimableAlph ||
      item.totalEarnedAlph !== existing.totalEarnedAlph ||
      !existing.claimableAlph ||
      !existing.totalEarnedAlph
    );
  });

  await Promise.allSettled(
    toWrite.map((item) =>
      dynamo.send(new PutCommand({ TableName: STAKERS_TABLE_NAME!, Item: { ...item, lastUpdated: new Date().toISOString() } })),
    ),
  );

  // Aggregate stats from all items
  let totalStakedRaw = 0;
  let totalLockedRaw = 0;
  let totalWithdrawableRaw = 0;
  for (const item of allItems) {
    totalStakedRaw += parseFloat(item.stakedAbx) || 0;
    totalLockedRaw += parseFloat(item.lockedAbx) || 0;
    totalWithdrawableRaw += parseFloat(item.withdrawableAbx) || 0;
  }

  await dynamo.send(
    new PutCommand({
      TableName: STAKERS_TABLE_NAME,
      Item: {
        stakerContract: STATS_PK_STAKERS,
        totalStakers: allItems.length,
        totalStakedAbx: totalStakedRaw.toFixed(2),
        totalLockedAbx: totalLockedRaw.toFixed(2),
        totalWithdrawableAbx: totalWithdrawableRaw.toFixed(2),
        updatedAt: new Date().toISOString(),
      },
    }),
  );

  // Step 7: remove stale (no longer in sub-contracts list)
  let removedStakers = 0;
  for (const [pk] of existingMap) {
    if (!activeContracts.has(pk)) {
      await dynamo.send(
        new DeleteCommand({ TableName: STAKERS_TABLE_NAME, Key: { stakerContract: pk } }),
      );
      removedStakers++;
    }
  }

  console.log(
    `[Watcher] Stakers: ${allItems.length} positions — ${toFullFetch.length} full-fetched` +
    ` (${toFullFetch.length - quickChangedAddrs.length} new/status-changed, ${quickChangedAddrs.length} amount-changed),` +
    ` ${toWrite.length} DDB writes, ${removedStakers} removed.`,
  );
}

// ─── Token / DEX distribution helpers ───────────────────────────────────────

const ABX_TOKEN_ID = "9b3070a93fd5127d8c39561870432fdbc79f598ca8dbf2a3398fc100dfd45f00";
const ABD_TOKEN_ID = "c7d1dab489ee40ca4e6554efc64a64e73a9f0ddfdec9e544c82c1c6742ccc500";
const ABX_ADDRESS = "258k9T6WqezTLdfGvHixXzK1yLATeSPuyhtcxzQ3V2pqV";
const ABD_ADDRESS = "288xqicj5pfGWuxJLKYU78Pe55LENz4ndGXRoykz7NL2K";
const ABX_TOTAL_SUPPLY_ATTO = "100000000000000000"; // 100M × 10^9

interface ElexiumPool {
  address: string;
  token: { symbol: string };
  token0Address: string;
  token1Address: string;
}

interface DexPoolSnapshot {
  symbol: string;
  poolAddress: string;
  reserve: string;
}

async function fetchDexReserves(
  nodeProvider: NodeProvider,
): Promise<{ abxPools: DexPoolSnapshot[]; abdPools: DexPoolSnapshot[] }> {
  const res = await fetch("https://api.elexium.finance/pools");
  if (!res.ok) throw new Error(`Elexium API ${res.status}`);
  const pools: ElexiumPool[] = await res.json();

  const abxPools: ElexiumPool[] = [];
  const abdPools: ElexiumPool[] = [];

  for (const pool of pools) {
    const hasAbx = pool.token0Address === ABX_ADDRESS || pool.token1Address === ABX_ADDRESS;
    const hasAbd = pool.token0Address === ABD_ADDRESS || pool.token1Address === ABD_ADDRESS;
    if (hasAbx) abxPools.push(pool);
    if (hasAbd) abdPools.push(pool);
  }

  async function readReserve(poolAddress: string, tokenId: string): Promise<string> {
    const bal = await nodeProvider.addresses.getAddressesAddressBalance(poolAddress);
    const entry = (bal.tokenBalances ?? []).find((t: { id: string; amount: string }) => t.id === tokenId);
    return entry ? entry.amount : "0";
  }

  const abxSnapshots = await Promise.all(
    abxPools.map(async (p) => ({
      symbol: p.token.symbol,
      poolAddress: p.address,
      reserve: await readReserve(p.address, ABX_TOKEN_ID),
    })),
  );

  const abdSnapshots = await Promise.all(
    abdPools.map(async (p) => ({
      symbol: p.token.symbol,
      poolAddress: p.address,
      reserve: await readReserve(p.address, ABD_TOKEN_ID),
    })),
  );

  return { abxPools: abxSnapshots, abdPools: abdSnapshots };
}

interface TreasuryAddrSnapshot {
  addr: string;
  amount: string;
}

async function fetchTreasuryBalances(
  nodeProvider: NodeProvider,
): Promise<{
  abxTreasury: string;
  abdTreasury: string;
  abxTreasuryAddrs: TreasuryAddrSnapshot[];
  abdTreasuryAddrs: TreasuryAddrSnapshot[];
}> {
  async function fetchAddrAmounts(
    addresses: string[],
    tokenId: string,
  ): Promise<TreasuryAddrSnapshot[]> {
    const results: TreasuryAddrSnapshot[] = [];
    for (const addr of addresses) {
      try {
        const bal = await nodeProvider.addresses.getAddressesAddressBalance(addr);
        const entry = (bal.tokenBalances ?? []).find((t: { id: string; amount: string }) => t.id === tokenId);
        results.push({ addr, amount: entry ? entry.amount : "0" });
      } catch {
        console.warn(`[Watcher] Could not fetch balance for treasury address ${addr}`);
        results.push({ addr, amount: "0" });
      }
    }
    return results;
  }

  const [abxAddrs, abdAddrs] = await Promise.all([
    fetchAddrAmounts(treasuryConfig.abx, ABX_TOKEN_ID),
    fetchAddrAmounts(treasuryConfig.abd, ABD_TOKEN_ID),
  ]);

  const abxTotal = abxAddrs.reduce((acc, a) => acc + BigInt(a.amount), 0n);
  const abdTotal = abdAddrs.reduce((acc, a) => acc + BigInt(a.amount), 0n);

  return {
    abxTreasury: abxTotal.toString(),
    abdTreasury: abdTotal.toString(),
    abxTreasuryAddrs: abxAddrs,
    abdTreasuryAddrs: abdAddrs,
  };
}

async function fetchAbdAuctionTotal(auctionManagerAddress: string): Promise<string> {
  const auctionManager = AuctionManager.at(auctionManagerAddress);
  const discountsResult = await auctionManager.view.getAllDiscounts();
  const discounts = Array.from(discountsResult.returns as [bigint, bigint, bigint, bigint]);

  let total = 0n;
  for (const discount of discounts) {
    const poolIdResult = await auctionManager.view.getAuctionPoolId({ args: { discount } });
    const poolAddress = addressFromContractId(poolIdResult.returns as string);
    const poolState = await AuctionPool.at(poolAddress).fetchState();
    total += poolState.fields.totalAbdAmount as bigint;
  }
  return total.toString();
}

async function fetchAbdTotalSupply(): Promise<string> {
  const abdToken = AbdToken.at(ABD_ADDRESS);
  const state = await abdToken.fetchState();
  return (state.fields.totalSupply as bigint).toString();
}

async function updateTokenStats(nodeProvider: NodeProvider, auctionManagerAddress: string): Promise<void> {
  if (!TOKEN_STATS_TABLE_NAME) {
    console.warn("[Watcher] TOKEN_STATS_TABLE_NAME not set — skipping token stats");
    return;
  }

  const [dex, treasury, abdAuction, abdSupply] = await Promise.all([
    fetchDexReserves(nodeProvider),
    fetchTreasuryBalances(nodeProvider),
    fetchAbdAuctionTotal(auctionManagerAddress),
    fetchAbdTotalSupply(),
  ]);

  // Read stakers summary for ABX-in-staking
  let abxInStaking = "0";
  if (STAKERS_TABLE_NAME) {
    try {
      const stats = await dynamo.send(
        new GetCommand({ TableName: STAKERS_TABLE_NAME, Key: { stakerContract: "__stats__" } }),
      );
      if (stats.Item) {
        const s = stats.Item.totalStakedAbx ?? "0";
        const l = stats.Item.totalLockedAbx ?? "0";
        const w = stats.Item.totalWithdrawableAbx ?? "0";
        // Stats row stores display values (decimal ABX) — convert back to atto for uniform storage
        const toAtto = (v: string) => BigInt(Math.round(parseFloat(v) * 1e9));
        abxInStaking = (toAtto(s) + toAtto(l) + toAtto(w)).toString();
      }
    } catch {
      console.warn("[Watcher] Could not read stakers __stats__ for token stats");
    }
  }

  const abxInDex = dex.abxPools.reduce((acc, p) => acc + BigInt(p.reserve), 0n).toString();
  const abdInDex = dex.abdPools.reduce((acc, p) => acc + BigInt(p.reserve), 0n).toString();

  await dynamo.send(
    new PutCommand({
      TableName: TOKEN_STATS_TABLE_NAME,
      Item: {
        pk: "__latest__",
        abxTotalSupply: ABX_TOTAL_SUPPLY_ATTO,
        abxInStaking,
        abxInDex,
        abxInDexPools: dex.abxPools,
        abxTreasury: treasury.abxTreasury,
        abxTreasuryAddrs: treasury.abxTreasuryAddrs,
        abdTotalSupply: abdSupply,
        abdInAuctionPools: abdAuction,
        abdInDex,
        abdInDexPools: dex.abdPools,
        abdTreasury: treasury.abdTreasury,
        abdTreasuryAddrs: treasury.abdTreasuryAddrs,
        updatedAt: new Date().toISOString(),
      },
    }),
  );

  console.log(
    `[Watcher] Token stats updated — ABX staking: ${abxInStaking}, ABX DEX: ${abxInDex}, ` +
    `ABD supply: ${abdSupply}, ABD auction: ${abdAuction}, ABD DEX: ${abdInDex}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export async function handler(): Promise<void> {
  console.log(`[Watcher] Starting at ${new Date().toISOString()}`);

  const nodeProvider = new NodeProvider(NODE_URL);
  web3.setCurrentNodeProvider(nodeProvider);

  const deployments = loadMainnetDeployments();
  const loanManager = deployments.contracts.LoanManager.contractInstance;
  const loanManagerContract = LoanManager.at(loanManager.address);
  const allInterestRates = (await loanManagerContract.view.getAllInterestRates()).returns as bigint[];

  const listIdResult = await loanManager.view.getLoansListId();
  const listId = listIdResult.returns as string;
  const listAddress = addressFromContractId(listId);

  const sortedList = SortedList.at(listAddress);
  const listState = await sortedList.fetchState();
  const { startNodeId, endNodeId, size } = listState.fields;

  console.log(`[Watcher] Total loans on-chain: ${size}`);

  if (size === 0n) {
    console.log("[Watcher] No open loans — clearing stale DynamoDB entries.");
    await removeStaleLoans(new Set());
    return;
  }

  const total = Number(size);
  const loanContractIds = await collectLoanContractIds(
    startNodeId,
    endNodeId,
    total,
    (msg) => console.log(`[Watcher] ${msg}`),
  );

  console.log(`[Watcher] Traversal complete — ${loanContractIds.length}/${total} loans found.`);

  if (loanContractIds.length < total) {
    console.warn(
      `[Watcher] Missing ${total - loanContractIds.length} loan(s) after forward + backward traversal.`,
    );
  }

  const activeAddresses = new Set<string>();
  let written = 0;

  for (const contractId of loanContractIds) {
    try {
      const loanAddress = addressFromContractId(contractId);
      activeAddresses.add(loanAddress);

      const loanState = await Loan.at(loanAddress).fetchState();
      const { owner, collateral, debt, debtDecimals, interestRate } = loanState.fields;

      const debtNorm = debtDecimals ? debt * SCALE / (10n ** debtDecimals) : debt;
      const cr = debtNorm > 0n ? (collateral * SCALE) / debtNorm : 999n * SCALE;
      const crZone = getCrZone(cr);

      await dynamo.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          loanAddress,
          owner: owner as string,
          collateral: formatAmount2(collateral as bigint, 18),
          debt: formatAmount2(debt as bigint, Number(debtDecimals as bigint)),
          interestRate: formatInterestRate(interestRate as bigint, allInterestRates),
          crZone,
          lastUpdated: new Date().toISOString(),
        },
      }));
      written++;
    } catch (err) {
      console.warn(`[Watcher] Failed to process loan ${contractId}: ${(err as Error).message}`);
    }
  }

  const traversalComplete = loanContractIds.length >= total;
  const removed = await removeStaleLoans(activeAddresses, traversalComplete);

  if (PRICES_TABLE_NAME) {
    try {
      const prices = await fetchOraclePrices();
      const recordedAt = await savePriceHistory(dynamo, PRICES_TABLE_NAME, prices);
      console.log(
        `[Watcher] Oracle prices stored — ALPH $${prices.alphUsd}, ABD $${prices.abdUsd} at ${recordedAt}`,
      );
    } catch (err) {
      console.warn(`[Watcher] Failed to store oracle prices: ${(err as Error).message}`);
    }
  }

  const auctionManagerAddress = deployments.contracts.AuctionManager.contractInstance.address;

  try {
    await trackBidEvents(nodeProvider, auctionManagerAddress);
  } catch (err) {
    console.warn(`[Watcher] Failed to track bid events: ${(err as Error).message}`);
  }

  try {
    await trackLiquidationEvents(nodeProvider, auctionManagerAddress);
  } catch (err) {
    console.warn(`[Watcher] Failed to track liquidation events: ${(err as Error).message}`);
  }

  const borrowerOpsAddress = deployments.contracts.BorrowerOperations.contractInstance.address;

  try {
    await trackBorrowerOperationsEvents(nodeProvider, borrowerOpsAddress, allInterestRates);
  } catch (err) {
    console.warn(`[Watcher] BorrowerOps event scan failed: ${(err as Error).message}`);
  }

  try {
    await trackStakerPositions(nodeProvider);
  } catch (err) {
    console.warn(`[Watcher] Staker positions scan failed: ${(err as Error).message}`);
  }

  try {
    await updateTokenStats(nodeProvider, auctionManagerAddress);
  } catch (err) {
    console.warn(`[Watcher] Token stats update failed: ${(err as Error).message}`);
  }

  console.log(
    `[Watcher] Done — wrote ${written}/${loanContractIds.length} loans, removed ${removed} stale.`,
  );
}
