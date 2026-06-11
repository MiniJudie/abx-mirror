import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

export interface StoredPrices {
  abdUsd: string | null;
  alphUsd: string | null;
  recordedAt: string | null;
}

export async function savePriceHistory(
  dynamo: DynamoDBDocumentClient,
  tableName: string,
  prices: { abdUsd: string; alphUsd: string },
): Promise<string> {
  const recordedAt = new Date().toISOString();

  await Promise.all([
    dynamo.send(
      new PutCommand({
        TableName: tableName,
        Item: { asset: "ABD", recordedAt, usdPrice: prices.abdUsd },
      }),
    ),
    dynamo.send(
      new PutCommand({
        TableName: tableName,
        Item: { asset: "ALPH", recordedAt, usdPrice: prices.alphUsd },
      }),
    ),
  ]);

  return recordedAt;
}

export async function getLatestPrices(
  dynamo: DynamoDBDocumentClient,
  tableName: string,
): Promise<StoredPrices> {
  const [abdResult, alphResult] = await Promise.all([
    dynamo.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "asset = :asset",
        ExpressionAttributeValues: { ":asset": "ABD" },
        ScanIndexForward: false,
        Limit: 1,
      }),
    ),
    dynamo.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "asset = :asset",
        ExpressionAttributeValues: { ":asset": "ALPH" },
        ScanIndexForward: false,
        Limit: 1,
      }),
    ),
  ]);

  const abdItem = abdResult.Items?.[0];
  const alphItem = alphResult.Items?.[0];

  const recordedAt =
    [abdItem?.recordedAt as string, alphItem?.recordedAt as string]
      .filter(Boolean)
      .sort()
      .pop() ?? null;

  return {
    abdUsd: (abdItem?.usdPrice as string) ?? null,
    alphUsd: (alphItem?.usdPrice as string) ?? null,
    recordedAt,
  };
}
