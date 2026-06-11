#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { WatcherStack } from "../lib/watcher-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.AWS_REGION ?? "eu-west-3",
};

const tableName = process.env.DYNAMODB_TABLE_NAME ?? "abx-loans";
const pricesTableName = process.env.PRICES_TABLE_NAME ?? "abx-prices";
const liquidationsTableName = process.env.LIQUIDATIONS_TABLE_NAME ?? "abx-liquidations";
const bidsTableName = process.env.BIDS_TABLE_NAME ?? "abx-bids";
const stakersTableName = process.env.STAKERS_TABLE_NAME ?? "abx-stakers";
const tokenStatsTableName = process.env.TOKEN_STATS_TABLE_NAME ?? "abx-token-stats";

new WatcherStack(app, "AbxWatcherStack", {
  env,
  loansTableName: tableName,
  pricesTableName,
  liquidationsTableName,
  bidsTableName,
  stakersTableName,
  tokenStatsTableName,
});
