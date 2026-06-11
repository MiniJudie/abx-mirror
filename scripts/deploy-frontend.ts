#!/usr/bin/env tsx
/**
 * pnpm deploy:frontend
 * Builds the Next.js static export and syncs it to S3 + invalidates CloudFront.
 * Checks S3 bucket existence as a safety net (CDK should own it, but handles edge cases).
 */
import { execa } from "execa";
import { S3Client, HeadBucketCommand, CreateBucketCommand, BucketLocationConstraint } from "@aws-sdk/client-s3";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { fromIni } from "@aws-sdk/credential-providers";
import { BACKEND_STACK, AWS_PROFILE, AWS_REGION, getStackOutput, stackExists } from "./utils.js";

async function ensureBucket(bucketName: string) {
  const s3 = new S3Client({ region: AWS_REGION, credentials: fromIni({ profile: AWS_PROFILE }) });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.log(`S3 bucket exists: ${bucketName}`);
  } catch (err: unknown) {
    const statusCode = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (statusCode === 404) {
      console.log(`S3 bucket not found — creating ${bucketName}...`);
      await s3.send(new CreateBucketCommand({
        Bucket: bucketName,
        CreateBucketConfiguration: { LocationConstraint: AWS_REGION as BucketLocationConstraint },
      }));
      console.log("Bucket created.");
    } else {
      throw err;
    }
  }
}

async function invalidateCloudFront(distributionId: string) {
  const cf = new CloudFrontClient({ region: "us-east-1", credentials: fromIni({ profile: AWS_PROFILE }) });
  await cf.send(new CreateInvalidationCommand({
    DistributionId: distributionId,
    InvalidationBatch: {
      CallerReference: `deploy-${Date.now()}`,
      Paths: { Quantity: 1, Items: ["/*"] },
    },
  }));
  console.log(`CloudFront invalidation created for ${distributionId}`);
}

async function main() {
  console.log("=== Deploy: ABX Frontend ===\n");

  const backendDeployed = await stackExists(BACKEND_STACK);
  if (!backendDeployed) {
    console.error(
      `Error: ${BACKEND_STACK} is not deployed yet.\n` +
      `Run \`pnpm deploy:api\` first, then re-run \`pnpm deploy:frontend\`.`,
    );
    process.exit(1);
  }

  // Values can be pinned in .env to skip CloudFormation lookups
  const apiUrl        = process.env.NEXT_PUBLIC_API_URL        ?? await getStackOutput(BACKEND_STACK, "ApiUrl");
  const bucketName    = process.env.S3_BUCKET_NAME             ?? await getStackOutput(BACKEND_STACK, "BucketName");
  const distributionId = process.env.CLOUDFRONT_DISTRIBUTION_ID ?? await getStackOutput(BACKEND_STACK, "DistributionId");
  const cfDomain      = process.env.CLOUDFRONT_DOMAIN          ?? await getStackOutput(BACKEND_STACK, "CloudFrontDomain");

  if (!apiUrl || !bucketName || !distributionId) {
    console.error(
      "Could not resolve API URL, bucket name, or distribution ID.\n" +
      "Either run `pnpm deploy:api` first, or set NEXT_PUBLIC_API_URL, " +
      "S3_BUCKET_NAME and CLOUDFRONT_DISTRIBUTION_ID in .env.",
    );
    process.exit(1);
  }

  console.log(`Building Next.js frontend with API_URL=${apiUrl}...`);
  await execa("pnpm", ["--filter", "frontend", "build"], {
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_API_URL: apiUrl },
  });

  await ensureBucket(bucketName);

  console.log(`\nSyncing frontend/out/ → s3://${bucketName} ...`);
  await execa(
    "aws",
    ["s3", "sync", "frontend/out/", `s3://${bucketName}`,
     "--delete",
     "--profile", AWS_PROFILE,
     "--region", AWS_REGION,
    ],
    { stdio: "inherit" },
  );

  console.log("\nInvalidating CloudFront cache...");
  await invalidateCloudFront(distributionId);

  console.log("\n=== Frontend deploy complete ===");
  console.log(`  Live at: https://${cfDomain}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
