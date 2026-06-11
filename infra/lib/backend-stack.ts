import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { Construct } from "constructs";
import * as path from "path";

function normalizeDomain(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.replace(/^https?:\/\//, "");
}

export class BackendStack extends cdk.Stack {
  public readonly loansTable: dynamodb.Table;
  public readonly pricesTable: dynamodb.Table;
  public readonly liquidationsTable: dynamodb.Table;
  public readonly bidsTable: dynamodb.Table;
  public readonly stakersTable: dynamodb.Table;
  public readonly tokenStatsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB table — PK: loanAddress
    this.loansTable = new dynamodb.Table(this, "LoansTable", {
      tableName: process.env.DYNAMODB_TABLE_NAME ?? "abx-loans",
      partitionKey: { name: "loanAddress", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Oracle price history — PK: asset (ALPH|ABD), SK: recordedAt
    this.pricesTable = new dynamodb.Table(this, "PricesTable", {
      tableName: process.env.PRICES_TABLE_NAME ?? "abx-prices",
      partitionKey: { name: "asset", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "recordedAt", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Liquidation event history — PK: txId (unique per liquidation tx)
    this.liquidationsTable = new dynamodb.Table(this, "LiquidationsTable", {
      tableName: process.env.LIQUIDATIONS_TABLE_NAME ?? "abx-liquidations",
      partitionKey: { name: "txId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Bid event index — PK: bid address; maps bid → discount %
    // Also stores the watcher cursor (PK "__cursor__") for NewBid event scanning.
    this.bidsTable = new dynamodb.Table(this, "BidsTable", {
      tableName: process.env.BIDS_TABLE_NAME ?? "abx-bids",
      partitionKey: { name: "bid", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Staking positions — PK: stakerContract (Staker sub-contract address)
    // Also stores a __stats__ summary row with aggregate totals.
    this.stakersTable = new dynamodb.Table(this, "StakersTable", {
      tableName: process.env.STAKERS_TABLE_NAME ?? "abx-stakers",
      partitionKey: { name: "stakerContract", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Token distribution snapshot — PK: pk (single row "__latest__")
    this.tokenStatsTable = new dynamodb.Table(this, "TokenStatsTable", {
      tableName: process.env.TOKEN_STATS_TABLE_NAME ?? "abx-token-stats",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const repoRoot = path.join(__dirname, "../..");
    const artifactsTs = path.join(repoRoot, "artifacts/artifacts/ts");

    // API Lambda
    const apiHandler = new lambdaNodejs.NodejsFunction(this, "ApiHandler", {
      entry: path.join(__dirname, "../lambda/api/handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: this.loansTable.tableName,
        PRICES_TABLE_NAME: this.pricesTable.tableName,
        LIQUIDATIONS_TABLE_NAME: this.liquidationsTable.tableName,
        BIDS_TABLE_NAME: this.bidsTable.tableName,
        STAKERS_TABLE_NAME: this.stakersTable.tableName,
        TOKEN_STATS_TABLE_NAME: this.tokenStatsTable.tableName,
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
              `test -d "${artifactsTs}" || (echo "ERROR: artifacts/artifacts/ts not found. The gitignored artifacts/ directory must exist locally to deploy the API." >&2 && exit 1)`,
            ];
          },
          afterBundling: () => [],
          beforeInstall: () => [],
        },
      },
    });

    this.loansTable.grantReadWriteData(apiHandler);
    this.pricesTable.grantReadData(apiHandler);
    this.liquidationsTable.grantReadData(apiHandler);
    this.bidsTable.grantReadData(apiHandler);
    this.stakersTable.grantReadWriteData(apiHandler);
    this.tokenStatsTable.grantReadData(apiHandler);

    const customDomain = normalizeDomain(process.env.CLOUDFRONT_CUSTOM_DOMAIN);

    // HTTP API Gateway
    const allowedOrigins = customDomain
      ? [`https://${customDomain}`, "*"]
      : ["*"];

    const httpApi = new apigatewayv2.HttpApi(this, "LoansApi", {
      apiName: process.env.API_NAME ?? "abx-loans-api",
      corsPreflight: {
        allowOrigins: allowedOrigins,
        allowMethods: [apigatewayv2.CorsHttpMethod.GET, apigatewayv2.CorsHttpMethod.POST],
        allowHeaders: ["Content-Type"],
      },
    });

    const apiIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
      "ApiIntegration",
      apiHandler,
    );

    httpApi.addRoutes({
      path: "/loans",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: apiIntegration,
    });

    httpApi.addRoutes({
      path: "/price",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: apiIntegration,
    });

    httpApi.addRoutes({
      path: "/loans/by-owner/{address}",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: apiIntegration,
    });

    httpApi.addRoutes({
      path: "/auctions",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: apiIntegration,
    });

    httpApi.addRoutes({
      path: "/liquidations",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: apiIntegration,
    });

    httpApi.addRoutes({
      path: "/auctions/{discount}/bids",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: apiIntegration,
    });

    httpApi.addRoutes({
      path: "/auctions/bidders",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: apiIntegration,
    });

    httpApi.addRoutes({
      path: "/auctions/positions/{wallet}",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: apiIntegration,
    });

    httpApi.addRoutes({
      path: "/loans/index",
      methods: [apigatewayv2.HttpMethod.POST],
      integration: apiIntegration,
    });

    httpApi.addRoutes({
      path: "/stakers",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: apiIntegration,
    });

    httpApi.addRoutes({
      path: "/stakers/by-owner/{wallet}",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: apiIntegration,
    });

    httpApi.addRoutes({
      path: "/stakers/reindex",
      methods: [apigatewayv2.HttpMethod.POST],
      integration: apiIntegration,
    });

    httpApi.addRoutes({
      path: "/token-stats",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: apiIntegration,
    });

    // S3 bucket for frontend static assets
    const frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      bucketName: process.env.S3_BUCKET_NAME ?? `abx-mirror-frontend-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // CloudFront OAC
    const oac = new cloudfront.S3OriginAccessControl(this, "FrontendOAC", {
      signing: cloudfront.Signing.SIGV4_NO_OVERRIDE,
    });

    const acmCertArn   = process.env.ACM_CERTIFICATE_ARN;
    const apiCustomDomain = normalizeDomain(process.env.API_CUSTOM_DOMAIN);

    const distribution = new cloudfront.Distribution(this, "FrontendDistribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket, {
          originAccessControl: oac,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
        },
      ],
    });

    if (apiCustomDomain && acmCertArn) {
      const apiOrigin = new origins.HttpOrigin(
        `${httpApi.apiId}.execute-api.${this.region}.amazonaws.com`,
        { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY },
      );

      // Alias is attached only when API_ATTACH_CUSTOM_DOMAIN=true (DNS must already
      // point at this distribution — CloudFront rejects aliases otherwise).
      const attachApiDomain = process.env.API_ATTACH_CUSTOM_DOMAIN === "true";

      const apiDistribution = new cloudfront.Distribution(this, "ApiDistribution", {
        ...(attachApiDomain
          ? {
              domainNames: [apiCustomDomain],
              certificate: acm.Certificate.fromCertificateArn(this, "ApiCert", acmCertArn),
            }
          : {}),
        defaultBehavior: {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      });

      new cdk.CfnOutput(this, "ApiCustomUrl", {
        value: attachApiDomain
          ? `https://${apiCustomDomain}`
          : `https://${apiDistribution.distributionDomainName}`,
        exportName: "AbxApiCustomUrl",
      });

      new cdk.CfnOutput(this, "ApiDistributionId", {
        value: apiDistribution.distributionId,
        exportName: "AbxApiDistributionId",
      });

      new cdk.CfnOutput(this, "ApiDistributionDomain", {
        value: apiDistribution.distributionDomainName,
        exportName: "AbxApiDistributionDomain",
      });
    }

    // Outputs
    new cdk.CfnOutput(this, "ApiUrl", {
      value: httpApi.apiEndpoint,
      exportName: "AbxApiUrl",
    });

    new cdk.CfnOutput(this, "TableName", {
      value: this.loansTable.tableName,
      exportName: "AbxTableName",
    });

    new cdk.CfnOutput(this, "PricesTableName", {
      value: this.pricesTable.tableName,
      exportName: "AbxPricesTableName",
    });

    new cdk.CfnOutput(this, "LiquidationsTableName", {
      value: this.liquidationsTable.tableName,
      exportName: "AbxLiquidationsTableName",
    });

    new cdk.CfnOutput(this, "BidsTableName", {
      value: this.bidsTable.tableName,
      exportName: "AbxBidsTableName",
    });

    new cdk.CfnOutput(this, "StakersTableName", {
      value: this.stakersTable.tableName,
      exportName: "AbxStakersTableName",
    });

    new cdk.CfnOutput(this, "TokenStatsTableName", {
      value: this.tokenStatsTable.tableName,
      exportName: "AbxTokenStatsTableName",
    });

    new cdk.CfnOutput(this, "TableArn", {
      value: this.loansTable.tableArn,
      exportName: "AbxTableArn",
    });

    new cdk.CfnOutput(this, "BucketName", {
      value: frontendBucket.bucketName,
      exportName: "AbxBucketName",
    });

    new cdk.CfnOutput(this, "DistributionId", {
      value: distribution.distributionId,
      exportName: "AbxDistributionId",
    });

    new cdk.CfnOutput(this, "CloudFrontDomain", {
      value: distribution.distributionDomainName,
      exportName: "AbxCloudFrontDomain",
    });
  }
}
