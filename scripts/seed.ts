#!/usr/bin/env tsx
/**
 * pnpm seed
 * Seeds the DynamoDB abx-loans table with sample loan data.
 * Safe to run multiple times (PutItem overwrites existing items).
 */
import { DynamoDBClient, DescribeTableCommand, CreateTableCommand, waitUntilTableExists } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { fromIni } from "@aws-sdk/credential-providers";
import { BACKEND_STACK, AWS_REGION, AWS_PROFILE, getStackOutput, stackExists } from "./utils.js";

const SAMPLE_LOANS = [
  {
    loanAddress: "tpxjsWJSaUh5i7XzNAsTWMRtD9QvDTV9zmMNeHHS6jQB",
    owner: "14eYAznWo6W6e5Rwm1e4XFwkgMcguoMvfPnWpoj9vfRac",
    collateral: "1500.0",
    debt: "1000.0",
    interestRate: "5.00%",
    crZone: "Active",
    lastUpdated: new Date().toISOString(),
  },
  {
    loanAddress: "288xqicj5pfGWuxJLKYU78Pe55LENz4ndGXRoykz7NL2K",
    owner: "15dR9sLfjRLp5gZ7DEJcTL8dgiVmvtcM9in2mK3ucANHV",
    collateral: "800.0",
    debt: "700.0",
    interestRate: "7.00%",
    crZone: "Risky",
    lastUpdated: new Date().toISOString(),
  },
  {
    loanAddress: "258k9T6WqezTLdfGvHixXzK1yLATeSPuyhtcxzQ3V2pqV",
    owner: "1BwH3NMUWx3g7q1BoANNMhRqzUGBBhGUNLCz8HjBMCHQG",
    collateral: "500.0",
    debt: "490.0",
    interestRate: "10.00%",
    crZone: "Auction",
    lastUpdated: new Date().toISOString(),
  },
];

async function ensureTable(client: DynamoDBClient, tableName: string) {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`DynamoDB table exists: ${tableName}`);
  } catch (err: unknown) {
    const name = (err as { name?: string }).name;
    if (name === "ResourceNotFoundException") {
      console.log(`Table not found — creating ${tableName}...`);
      await client.send(new CreateTableCommand({
        TableName: tableName,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [{ AttributeName: "loanAddress", AttributeType: "S" }],
        KeySchema: [{ AttributeName: "loanAddress", KeyType: "HASH" }],
      }));
      await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: tableName });
      console.log("Table created.");
    } else {
      throw err;
    }
  }
}

async function main() {
  console.log("=== Seed: ABX DynamoDB ===\n");

  let tableName: string | undefined;

  // DYNAMODB_TABLE_NAME in .env takes precedence over CloudFormation lookup
  if (process.env.DYNAMODB_TABLE_NAME) {
    tableName = process.env.DYNAMODB_TABLE_NAME;
    console.log(`Using table from .env: ${tableName}`);
  } else if (await stackExists(BACKEND_STACK)) {
    tableName = await getStackOutput(BACKEND_STACK, "TableName");
    console.log(`Using table from stack: ${tableName}`);
  }

  if (!tableName) {
    tableName = "abx-loans";
    console.log(`Falling back to default table name: ${tableName}`);
  }

  const dynamo = new DynamoDBClient({
    region: AWS_REGION,
    credentials: fromIni({ profile: AWS_PROFILE }),
  });
  const docClient = DynamoDBDocumentClient.from(dynamo);

  await ensureTable(dynamo, tableName);

  console.log(`\nInserting ${SAMPLE_LOANS.length} sample loans...`);
  for (const loan of SAMPLE_LOANS) {
    await docClient.send(new PutCommand({ TableName: tableName, Item: loan }));
    console.log(`  Inserted: ${loan.loanAddress.slice(0, 12)}…`);
  }

  console.log("\n=== Seed complete ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
