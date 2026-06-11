import { addressFromContractId, NodeProvider, web3 } from "@alephium/web3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { Loan } from "../../../artifacts/artifacts/ts/Loan";
import { LoanManager } from "../../../artifacts/artifacts/ts/LoanManager";
import { formatAmount2 } from "../shared/format-amount";
import { formatInterestRate } from "../shared/interest-rate";
import { fetchOraclePrices } from "../shared/oracle-price";
import { getLatestPrices } from "../shared/price-store";
import { loadMainnetDeployments } from "../watcher/load-deployments";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;
const PRICES_TABLE_NAME = process.env.PRICES_TABLE_NAME;
const NODE_URL = process.env.NODE_URL ?? "https://node.mainnet.alphscan.io";

const SCALE = 10n ** 18n;

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
      Limit: 1,
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

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const path = event.rawPath ?? event.requestContext.http.path;

  const byOwnerMatch = path.match(/\/loans\/by-owner\/([^/?]+)/);

  try {
    if (path === "/price" || path.endsWith("/price")) {
      return await handlePrice();
    }
    if (byOwnerMatch) {
      return await handleLoanByOwner(decodeURIComponent(byOwnerMatch[1]));
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
