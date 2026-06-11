#!/usr/bin/env tsx
/**
 * pnpm seed:loan
 *
 * Seeds a single loan into the abx-loans DynamoDB table by fetching its
 * current state from the Alephium node. Use this to manually index a loan
 * that was missed by the SortedList traversal.
 *
 * Flags:
 *   --owner <address>   Look up the loan via LoanManager.getLoanId(owner)
 *   --loan  <address>   Index the loan contract at this address directly
 *
 * Examples:
 *   pnpm tsx scripts/seed-loan.ts --owner 17Cf96JCpxfyY2EdHSXV88rWLPsMUoCVMxUTMMvmDFwPv
 *   pnpm tsx scripts/seed-loan.ts --loan  vSiqnci8rNxLGY246uuwFvzm9qCnXgTG6N8qqF7xHPD1
 *
 * Environment (read from .env):
 *   LOANS_TABLE_NAME      DynamoDB table name (default: abx-loans)
 *   AWS_PROFILE           AWS credentials profile (default: default)
 *   AWS_REGION            AWS region (default: eu-west-3)
 *   ALEPHIUM_NODE_URL     Alephium node URL
 */
import "dotenv/config";
import { addressFromContractId, NodeProvider, web3 } from "@alephium/web3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { fromIni } from "@aws-sdk/credential-providers";
import { Loan } from "../artifacts/artifacts/ts/Loan";
import { LoanManager } from "../artifacts/artifacts/ts/LoanManager";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deployments = require("../infra/contracts/deployments.mainnet.json") as typeof import("../infra/contracts/deployments.mainnet.json");

const AWS_PROFILE = process.env.AWS_PROFILE ?? "default";
const AWS_REGION = process.env.AWS_REGION ?? "eu-west-3";
const NODE_URL = process.env.ALEPHIUM_NODE_URL ?? "https://node.mainnet.alphscan.io";
const LOANS_TABLE = process.env.LOANS_TABLE_NAME ?? "abx-loans";

const SCALE = 10n ** 18n;

// ── helpers ───────────────────────────────────────────────────────────────────

function formatAmount2(raw: bigint, decimals = 18): string {
  const num = Number(raw) / 10 ** decimals;
  if (!Number.isFinite(num)) return "0.00";
  return num.toFixed(2);
}

function formatInterestRate(index: bigint, allRates: bigint[]): string {
  const idx = Number(index);
  const rate = allRates[idx];
  if (rate === undefined) return `rate-${idx}`;
  const bps = (rate * 10000n) / SCALE;
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

function getCrZone(cr: bigint): string {
  const oneE18 = 10n ** 18n;
  if (cr < oneE18) return "Undercollateralized";
  if (cr < (11n * oneE18) / 10n) return "Auction";
  if (cr < (15n * oneE18) / 10n) return "Risky";
  return "Active";
}

function makeDynamo() {
  const credentials = AWS_PROFILE !== "default"
    ? fromIni({ profile: AWS_PROFILE })
    : undefined;
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: AWS_REGION, credentials }),
  );
}

// ── arg parsing ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const ownerIdx = args.indexOf("--owner");
const loanIdx = args.indexOf("--loan");

const ownerArg = ownerIdx !== -1 ? args[ownerIdx + 1] : undefined;
const loanArg = loanIdx !== -1 ? args[loanIdx + 1] : undefined;

if (!ownerArg && !loanArg) {
  console.error("Usage:");
  console.error("  pnpm tsx scripts/seed-loan.ts --owner <wallet-address>");
  console.error("  pnpm tsx scripts/seed-loan.ts --loan  <loan-contract-address>");
  process.exit(1);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  web3.setCurrentNodeProvider(new NodeProvider(NODE_URL));
  const dynamo = makeDynamo();

  const loanManagerAddress =
    deployments.contracts.LoanManager.contractInstance.address;
  const loanManagerContract = LoanManager.at(loanManagerAddress);
  const allInterestRates = (
    await loanManagerContract.view.getAllInterestRates()
  ).returns as bigint[];

  let loanAddress = loanArg;

  if (!loanAddress) {
    console.log(`Looking up loan for owner: ${ownerArg}`);
    try {
      const result = await loanManagerContract.view.getLoanId({
        args: { owner: ownerArg! },
      });
      loanAddress = addressFromContractId(result.returns as string);
      console.log(`  Loan contract: ${loanAddress}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("5004") || msg.toLowerCase().includes("not exist")) {
        console.error(`No loan found for owner: ${ownerArg}`);
      } else {
        console.error(`Error looking up loan: ${msg}`);
      }
      process.exit(1);
    }
  } else {
    console.log(`Indexing loan at address: ${loanAddress}`);
  }

  const loanState = await Loan.at(loanAddress).fetchState();
  const { owner, collateral, debt, debtDecimals, interestRate } = loanState.fields;

  const debtNorm =
    (debtDecimals as bigint) !== 0n
      ? ((debt as bigint) * SCALE) / 10n ** (debtDecimals as bigint)
      : (debt as bigint);
  const cr =
    debtNorm > 0n ? ((collateral as bigint) * SCALE) / debtNorm : 999n * SCALE;
  const crZone = getCrZone(cr);

  const item = {
    loanAddress,
    owner: owner as string,
    collateral: formatAmount2(collateral as bigint, 18),
    debt: formatAmount2(debt as bigint, Number(debtDecimals as bigint)),
    interestRate: formatInterestRate(interestRate as bigint, allInterestRates),
    crZone,
    lastUpdated: new Date().toISOString(),
  };

  console.log("\nLoan data:");
  console.log(`  loanAddress  : ${item.loanAddress}`);
  console.log(`  owner        : ${item.owner}`);
  console.log(`  collateral   : ${item.collateral} ALPH`);
  console.log(`  debt         : ${item.debt} ABD`);
  console.log(`  interestRate : ${item.interestRate}`);
  console.log(`  crZone       : ${item.crZone}`);

  await dynamo.send(new PutCommand({ TableName: LOANS_TABLE, Item: item }));
  console.log(`\nSuccessfully upserted to ${LOANS_TABLE}.`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
