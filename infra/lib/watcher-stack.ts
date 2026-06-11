import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { Construct } from "constructs";
import * as path from "path";

interface WatcherStackProps extends cdk.StackProps {
  loansTableName: string;
  pricesTableName: string;
  liquidationsTableName: string;
  bidsTableName: string;
  stakersTableName: string;
  tokenStatsTableName: string;
}

export class WatcherStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WatcherStackProps) {
    super(scope, id, props);

    const { loansTableName, pricesTableName, liquidationsTableName, bidsTableName, stakersTableName, tokenStatsTableName } = props;
    const loansTable = dynamodb.Table.fromTableName(this, "LoansTable", loansTableName);
    const pricesTable = dynamodb.Table.fromTableName(this, "PricesTable", pricesTableName);
    const liquidationsTable = dynamodb.Table.fromTableName(this, "LiquidationsTable", liquidationsTableName);
    const bidsTable = dynamodb.Table.fromTableName(this, "BidsTable", bidsTableName);
    const stakersTable = dynamodb.Table.fromTableName(this, "StakersTable", stakersTableName);
    const tokenStatsTable = dynamodb.Table.fromTableName(this, "TokenStatsTable", tokenStatsTableName);

    const repoRoot = path.join(__dirname, "../..");
    const artifactsTs = path.join(repoRoot, "artifacts/artifacts/ts");

    const watcherHandler = new lambdaNodejs.NodejsFunction(this, "WatcherHandler", {
      entry: path.join(__dirname, "../lambda/watcher/handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(4),
      memorySize: 512,
      environment: {
        TABLE_NAME: loansTableName,
        PRICES_TABLE_NAME: pricesTableName,
        LIQUIDATIONS_TABLE_NAME: liquidationsTableName,
        BIDS_TABLE_NAME: bidsTableName,
        STAKERS_TABLE_NAME: stakersTableName,
        TOKEN_STATS_TABLE_NAME: tokenStatsTableName,
        NODE_URL: process.env.ALEPHIUM_NODE_URL ?? "https://node.mainnet.alphscan.io",
      },
      bundling: {
        minify: true,
        sourceMap: false,
        externalModules: ["@aws-sdk/*"],
        nodeModules: ["@alephium/web3"],
        loader: {
          ".json": "json",
        },
        commandHooks: {
          beforeBundling(_inputDir: string, _outputDir: string): string[] {
            return [
              `test -d "${artifactsTs}" || (echo "ERROR: artifacts/artifacts/ts not found. The gitignored artifacts/ directory must exist locally to deploy the watcher." >&2 && exit 1)`,
            ];
          },
          afterBundling: () => [],
          beforeInstall: () => [],
        },
      },
    });

    loansTable.grantReadWriteData(watcherHandler);
    pricesTable.grantWriteData(watcherHandler);
    liquidationsTable.grantReadWriteData(watcherHandler);
    bidsTable.grantReadWriteData(watcherHandler);
    stakersTable.grantReadWriteData(watcherHandler);
    tokenStatsTable.grantWriteData(watcherHandler);

    const rule = new events.Rule(this, "WatcherSchedule", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      description: "Trigger ABX on-chain loan indexer every 5 minutes",
    });

    rule.addTarget(new targets.LambdaFunction(watcherHandler, {
      retryAttempts: 2,
    }));

    new cdk.CfnOutput(this, "WatcherFunctionArn", {
      value: watcherHandler.functionArn,
    });
  }
}
