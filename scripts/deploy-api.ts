#!/usr/bin/env tsx
/**
 * pnpm deploy:api
 * Deploys AbxBackendStack (DynamoDB + API Lambda + API Gateway + S3 + CloudFront).
 * Creates all resources if they don't exist; updates them if they do (CDK is idempotent).
 */
import { promises as dns } from "dns";
import { ensureCdkBootstrap, cdkDeploy, BACKEND_STACK, getStackOutput } from "./utils.js";

function normalizeDomain(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.trim().replace(/\/+$/, "").replace(/^https?:\/\//, "");
}

async function assertApiDnsReady() {
  if (process.env.API_ATTACH_CUSTOM_DOMAIN !== "true") return;

  const customDomain = normalizeDomain(process.env.API_CUSTOM_DOMAIN);
  const expectedTarget = normalizeDomain(
    process.env.API_DISTRIBUTION_DOMAIN
      ?? await getStackOutput(BACKEND_STACK, "ApiDistributionDomain"),
  );

  if (!customDomain) {
    console.error("API_ATTACH_CUSTOM_DOMAIN=true requires API_CUSTOM_DOMAIN in .env");
    process.exit(1);
  }
  if (!expectedTarget) {
    console.error(
      "API_ATTACH_CUSTOM_DOMAIN=true but ApiDistributionDomain is unknown.\n" +
      "Run deploy once with API_ATTACH_CUSTOM_DOMAIN unset, then pin API_DISTRIBUTION_DOMAIN in .env.",
    );
    process.exit(1);
  }

  let targets: string[] = [];
  try {
    targets = await dns.resolveCname(customDomain);
  } catch {
    console.error(
      `DNS for ${customDomain} does not CNAME to ${expectedTarget} yet.\n` +
      `Update the CNAME record, wait for propagation, then re-run deploy.`,
    );
    process.exit(1);
  }

  const normalized = targets.map((t) => t.replace(/\.$/, "").toLowerCase());
  const expected = expectedTarget.toLowerCase();
  if (!normalized.includes(expected)) {
    console.error(
      `DNS mismatch for ${customDomain}:\n` +
      `  Current CNAME: ${normalized.join(", ")}\n` +
      `  Required:      ${expected}\n` +
      `CloudFront rejects the custom alias until DNS points at this distribution.`,
    );
    process.exit(1);
  }
}

async function main() {
  console.log("=== Deploy: ABX Backend Stack ===\n");

  await ensureCdkBootstrap();
  await assertApiDnsReady();

  console.log(`\nDeploying ${BACKEND_STACK}...`);
  await cdkDeploy(BACKEND_STACK);

  const apiUrl = await getStackOutput(BACKEND_STACK, "ApiUrl");
  const apiCustomUrl = await getStackOutput(BACKEND_STACK, "ApiCustomUrl");
  const apiDistributionDomain = await getStackOutput(BACKEND_STACK, "ApiDistributionDomain");
  const bucketName = await getStackOutput(BACKEND_STACK, "BucketName");
  const cfDomain = await getStackOutput(BACKEND_STACK, "CloudFrontDomain");

  console.log("\n=== Deploy complete ===");
  console.log(`  API URL:     ${apiCustomUrl ?? apiUrl}`);
  if (apiDistributionDomain) {
    console.log(`  API CDN:     https://${apiDistributionDomain}`);
    if (!process.env.API_ATTACH_CUSTOM_DOMAIN) {
      console.log(
        "  To enable api-abx custom domain:\n" +
        `    1. CNAME api-abx → ${apiDistributionDomain}\n` +
        "    2. Set API_ATTACH_CUSTOM_DOMAIN=true in .env\n" +
        "    3. Re-run pnpm deploy:api and pnpm deploy:frontend",
      );
    }
  }
  console.log(`  S3 Bucket:   ${bucketName}`);
  console.log(`  Frontend:    https://${cfDomain}`);
  console.log("\nNext: run `pnpm deploy:frontend` to publish the frontend.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
