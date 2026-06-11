/**
 * Watcher Lambda — triggered every 5 minutes by EventBridge.
 * Traverses the AlphBanx SortedList on-chain to collect all open loans,
 * then bulk-upserts them into DynamoDB.
 */
import { addressFromContractId, NodeProvider, web3 } from "@alephium/web3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { Loan } from "../../../artifacts/artifacts/ts/Loan";
import { LoanManager } from "../../../artifacts/artifacts/ts/LoanManager";
import { SortedList } from "../../../artifacts/artifacts/ts/SortedList";
import { formatAmount2 } from "../shared/format-amount";
import { formatInterestRate } from "../shared/interest-rate";
import { fetchOraclePrices } from "../shared/oracle-price";
import { savePriceHistory } from "../shared/price-store";
import { collectLoanContractIds } from "../shared/traverse-loans";
import { loadMainnetDeployments } from "./load-deployments";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
const PRICES_TABLE_NAME = process.env.PRICES_TABLE_NAME;
const NODE_URL = process.env.NODE_URL ?? "https://node.mainnet.alphscan.io";

const SCALE = 10n ** 18n;

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

  console.log(
    `[Watcher] Done — wrote ${written}/${loanContractIds.length} loans, removed ${removed} stale.`,
  );
}
