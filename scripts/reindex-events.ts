#!/usr/bin/env tsx
/**
 * pnpm reindex:events
 *
 * Locally scans ALL AuctionManager contract events and rebuilds the
 * abx-bids and abx-liquidations tables without waiting for the Lambda.
 *
 * Unlike the Lambda watcher (which processes 100 events per 5-minute run),
 * this script loops through every page until fully caught up.
 *
 * Flags:
 *   --reset      Reset both cursors to 0 (re-processes all history from scratch)
 *   --overwrite  Like --reset but also removes ConditionExpression guards so existing
 *                records are overwritten (use to backfill liquidator / fix discount)
 *   --bids-only  Only re-index NewBid events (abx-bids table)
 *   --liq-only   Only re-index Liquidation/BidWin events (abx-liquidations table)
 *
 * Environment:
 *   All variables are read from .env (dotenv/config) or shell environment.
 *   Credentials: uses AWS_PROFILE (fromIni) or the SDK default credential chain.
 */
import "dotenv/config";
import { getSenderAddress, NodeProvider } from "@alephium/web3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { fromIni } from "@aws-sdk/credential-providers";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deployments = require("../infra/contracts/deployments.mainnet.json") as typeof import("../infra/contracts/deployments.mainnet.json");

const AWS_PROFILE = process.env.AWS_PROFILE ?? "default";
const AWS_REGION = process.env.AWS_REGION ?? "eu-west-3";
const NODE_URL = process.env.ALEPHIUM_NODE_URL ?? "https://node.mainnet.alphscan.io";
const LIQUIDATIONS_TABLE = process.env.LIQUIDATIONS_TABLE_NAME ?? "abx-liquidations";
const BIDS_TABLE = process.env.BIDS_TABLE_NAME ?? "abx-bids";

const NEW_BID_EVENT_INDEX = 3;
const CANCEL_BID_EVENT_INDEX = 4;
const LIQUIDATION_EVENT_INDEX = 5;
const BID_WIN_EVENT_INDEX = 6;
const BID_PARTIAL_WIN_EVENT_INDEX = 7;
const CURSOR_PK = "__cursor__";
const STATS_PK = "__stats__";
const PAGE_SIZE = 100; // Alephium node API maximum

const args = process.argv.slice(2);
const doOverwrite = args.includes("--overwrite");
const doReset = doOverwrite || args.includes("--reset");
const bidsOnly = args.includes("--bids-only");
const liqOnly = args.includes("--liq-only");

// ── helpers ──────────────────────────────────────────────────────────────────

function formatAmount2(raw: bigint, decimals = 18): string {
  const num = Number(raw) / 10 ** decimals;
  if (!Number.isFinite(num)) return "0.00";
  return num.toFixed(2);
}

function progress(label: string, current: number, total: number) {
  const pct = total > 0 ? ((current / total) * 100).toFixed(1) : "0.0";
  process.stdout.write(`\r  ${label}: ${current}/${total} (${pct}%)`);
}

// ── DynamoDB client ───────────────────────────────────────────────────────────

function makeDynamo() {
  const credentials = AWS_PROFILE !== "default"
    ? fromIni({ profile: AWS_PROFILE })
    : undefined;
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: AWS_REGION, credentials }),
  );
}

// ── cursor helpers ────────────────────────────────────────────────────────────

async function readCursor(
  dynamo: DynamoDBDocumentClient,
  table: string,
  pk: string,
  pkField: string,
): Promise<number> {
  try {
    const result = await dynamo.send(
      new GetCommand({ TableName: table, Key: { [pkField]: pk } }),
    );
    return (result.Item?.nextStart as number | undefined) ?? 0;
  } catch {
    return 0;
  }
}

async function writeCursor(
  dynamo: DynamoDBDocumentClient,
  table: string,
  pk: string,
  pkField: string,
  nextStart: number,
) {
  await dynamo.send(
    new PutCommand({
      TableName: table,
      Item: { [pkField]: pk, nextStart, updatedAt: new Date().toISOString() },
    }),
  );
}

// ── Phase 1: index NewBid events → abx-bids ──────────────────────────────────

async function reindexBids(
  nodeProvider: NodeProvider,
  dynamo: DynamoDBDocumentClient,
  auctionManagerAddress: string,
) {
  console.log("\n[1/2] Indexing NewBid events → abx-bids");

  const fromCursor = doReset
    ? 0
    : await readCursor(dynamo, BIDS_TABLE, CURSOR_PK, "bid");

  const totalCount =
    await nodeProvider.events.getEventsContractContractaddressCurrentCount(
      auctionManagerAddress,
    );

  if (totalCount <= fromCursor) {
    console.log(`  Already up to date (cursor=${fromCursor}).`);
    return;
  }

  let cursor = fromCursor;
  let totalStored = 0;

  while (cursor < totalCount) {
    progress("cursor", cursor, totalCount);

    const result =
      await nodeProvider.events.getEventsContractContractaddress(
        auctionManagerAddress,
        { start: cursor, limit: PAGE_SIZE },
      );

    for (const event of result.events) {
      const fields = event.fields as Array<{ value: string }>;

      if (event.eventIndex === NEW_BID_EVENT_INDEX) {
        // NewBid: [bid, bidder, owner, abdAmount, discount, index]
        const bid = fields[0].value;
        const bidOwner = fields[2].value;
        const abdAmount = formatAmount2(BigInt(fields[3].value), 9);
        const discountPercent = Number(BigInt(fields[4].value));
        const bidIndex = fields[5].value;

        try {
          await dynamo.send(
            new PutCommand({
              TableName: BIDS_TABLE,
              Item: {
                bid,
                bidOwner,
                abdAmount,
                discountPercent,
                bidIndex,
                bidStatus: "open",
                recordedAt: new Date().toISOString(),
              },
              ...(!doOverwrite && { ConditionExpression: "attribute_not_exists(bid)" }),
            }),
          );
          totalStored++;
        } catch {
          // Already exists and not overwriting — skip
        }
      } else if (doOverwrite && event.eventIndex === CANCEL_BID_EVENT_INDEX) {
        // CancelBid: [bid, bidder, owner, abdAmount]
        const bid = fields[0].value;
        await dynamo.send(new UpdateCommand({
          TableName: BIDS_TABLE,
          Key: { bid },
          UpdateExpression: "SET bidStatus = :s",
          ExpressionAttributeValues: { ":s": "canceled" },
        })).catch(() => {});
      } else if (doOverwrite && event.eventIndex === BID_WIN_EVENT_INDEX) {
        // BidWin: bid fully consumed — mark completed so bidder stats excludes it,
        // but keep the record so discount lookups still work for the matching Liquidation event.
        const bid = fields[0].value;
        await dynamo.send(new UpdateCommand({
          TableName: BIDS_TABLE,
          Key: { bid },
          UpdateExpression: "SET bidStatus = :s",
          ExpressionAttributeValues: { ":s": "completed" },
        })).catch(() => {});
      } else if (doOverwrite && event.eventIndex === BID_PARTIAL_WIN_EVENT_INDEX) {
        // BidPartialWin: [bid, bidder, owner, loan, abdAmount, remainingAbd, reward]
        const bid = fields[0].value;
        const remaining = formatAmount2(BigInt(fields[5].value), 9);
        await dynamo.send(new UpdateCommand({
          TableName: BIDS_TABLE,
          Key: { bid },
          UpdateExpression: "SET abdAmount = :a",
          ExpressionAttributeValues: { ":a": remaining },
        })).catch(() => {});
      }
    }

    cursor = result.nextStart ?? totalCount;
    await writeCursor(dynamo, BIDS_TABLE, CURSOR_PK, "bid", cursor);
  }

  console.log(`\n  Done. ${totalStored} new bids stored.`);

  // Update summary stats record
  async function countByStatus(status: string): Promise<number> {
    let count = 0;
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await dynamo.send(
        new ScanCommand({
          TableName: BIDS_TABLE,
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
  await dynamo.send(new PutCommand({
    TableName: BIDS_TABLE,
    Item: { bid: STATS_PK, openCount, filledCount, canceledCount, updatedAt: new Date().toISOString() },
  }));
  console.log(`  Stats: open=${openCount}, filled=${filledCount}, canceled=${canceledCount}`);
}

// ── Phase 2: index Liquidation events → abx-liquidations ─────────────────────

async function getBidDiscount(
  dynamo: DynamoDBDocumentClient,
  bidAddress: string,
): Promise<number | null> {
  try {
    const result = await dynamo.send(
      new GetCommand({ TableName: BIDS_TABLE, Key: { bid: bidAddress } }),
    );
    return (result.Item?.discountPercent as number | undefined) ?? null;
  } catch {
    return null;
  }
}

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

async function reindexLiquidations(
  nodeProvider: NodeProvider,
  dynamo: DynamoDBDocumentClient,
  auctionManagerAddress: string,
) {
  console.log("\n[2/2] Indexing Liquidation events → abx-liquidations");

  const fromCursor = doReset
    ? 0
    : await readCursor(dynamo, LIQUIDATIONS_TABLE, CURSOR_PK, "txId");

  const totalCount =
    await nodeProvider.events.getEventsContractContractaddressCurrentCount(
      auctionManagerAddress,
    );

  if (totalCount <= fromCursor) {
    console.log(`  Already up to date (cursor=${fromCursor}).`);
    return;
  }

  let cursor = fromCursor;
  let totalStored = 0;
  let totalSkipped = 0;

  while (cursor < totalCount) {
    progress("cursor", cursor, totalCount);

    const result =
      await nodeProvider.events.getEventsContractContractaddress(
        auctionManagerAddress,
        { start: cursor, limit: PAGE_SIZE },
      );

    // Build txId → bid → BidWin data map for this page.
    // Keyed by bid address (inner key) to deduplicate ghost-block duplicates: the Alephium
    // node returns the same events twice when a tx appears in both a ghost block and the
    // canonical block. Using bid as the inner key ensures each bid is only counted once.
    type BidWinData = { bid: string; owner: string; abdAmount: bigint; reward: bigint };
    const bidWinByTxId = new Map<string, Map<string, BidWinData>>();

    for (const event of result.events) {
      if (
        event.eventIndex !== BID_WIN_EVENT_INDEX &&
        event.eventIndex !== BID_PARTIAL_WIN_EVENT_INDEX
      ) continue;

      const fields = event.fields as Array<{ value: string }>;
      // BidWin:        [bid, bidder, owner, loan, abdAmount, reward]
      // BidPartialWin: [bid, bidder, owner, loan, abdAmount, remainingAbd, reward]
      const bid = fields[0].value;
      const owner = fields[2].value;
      const abdAmount = BigInt(fields[4].value);
      const rewardIdx = event.eventIndex === BID_WIN_EVENT_INDEX ? 5 : 6;
      const reward = BigInt(fields[rewardIdx].value);

      const byBid = bidWinByTxId.get(event.txId) ?? new Map<string, BidWinData>();
      if (!byBid.has(bid)) {
        byBid.set(bid, { bid, owner, abdAmount, reward });
        bidWinByTxId.set(event.txId, byBid);
      }
    }

    for (const event of result.events) {
      if (event.eventIndex !== LIQUIDATION_EVENT_INDEX) continue;

      const fields = event.fields as Array<{ value: string }>;
      // Liquidation: [loan, loanOwner, newCollateral, newDebt]
      const loan = fields[0].value;
      const loanOwner = fields[1].value;
      const newCollateral = fields[2].value;
      const newDebt = fields[3].value;

      // Enrich with BidWin data from same tx
      const bidWins = Array.from((bidWinByTxId.get(event.txId) ?? new Map()).values());
      let auctionOwner: string | undefined;
      let totalAbdLiquidated = 0n;
      let totalAlphReward = 0n;
      let discountPercent: number | null = null;

      for (const bw of bidWins) {
        auctionOwner = bw.owner;
        totalAbdLiquidated += bw.abdAmount;
        totalAlphReward += bw.reward;
        if (discountPercent === null) {
          discountPercent = await getBidDiscount(dynamo, bw.bid);
        }
      }

      const liquidator = await getLiquidatorFromTx(nodeProvider, event.txId);

      try {
        await dynamo.send(
          new PutCommand({
            TableName: LIQUIDATIONS_TABLE,
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
            ...(!doOverwrite && { ConditionExpression: "attribute_not_exists(txId)" }),
          }),
        );
        totalStored++;
      } catch {
        totalSkipped++;
      }
    }

    cursor = result.nextStart ?? totalCount;
    await writeCursor(dynamo, LIQUIDATIONS_TABLE, CURSOR_PK, "txId", cursor);
  }

  console.log(`\n  Done. ${totalStored} new liquidations stored, ${totalSkipped} already existed.`);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== ABX Event Reindex ===");
  if (doOverwrite) console.log("  --overwrite: cursors reset to 0, existing records will be overwritten\n");
  else if (doReset) console.log("  --reset: cursors will be set to 0\n");
  if (bidsOnly) console.log("  --bids-only: skipping liquidation indexing");
  if (liqOnly) console.log("  --liq-only: skipping bid indexing");

  const auctionManagerAddress =
    (deployments as any).contracts.AuctionManager.contractInstance.address as string;

  console.log(`  AuctionManager: ${auctionManagerAddress}`);
  console.log(`  Node:           ${NODE_URL}`);
  console.log(`  Region:         ${AWS_REGION}`);
  console.log(`  Bids table:     ${BIDS_TABLE}`);
  console.log(`  Liq table:      ${LIQUIDATIONS_TABLE}`);
  console.log();

  const nodeProvider = new NodeProvider(NODE_URL);
  const dynamo = makeDynamo();

  if (!liqOnly) {
    await reindexBids(nodeProvider, dynamo, auctionManagerAddress);
  }
  if (!bidsOnly) {
    await reindexLiquidations(nodeProvider, dynamo, auctionManagerAddress);
  }

  console.log("\n=== Reindex complete ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
