#!/usr/bin/env tsx
/**
 * pnpm deploy:watcher
 * Deploys AbxWatcherStack (EventBridge + Watcher Lambda).
 * Requires AbxBackendStack to be deployed first (needs DynamoDB table name).
 */
import {
  ensureCdkBootstrap, cdkDeploy, BACKEND_STACK, WATCHER_STACK,
  stackExists, getStackOutput,
} from "./utils.js";

async function main() {
  console.log("=== Deploy: ABX Watcher Stack ===\n");

  const backendDeployed = await stackExists(BACKEND_STACK);
  if (!backendDeployed) {
    console.error(
      `Error: ${BACKEND_STACK} is not deployed yet.\n` +
      `Run \`pnpm deploy:api\` first, then re-run \`pnpm deploy:watcher\`.`,
    );
    process.exit(1);
  }

  const tableArn = await getStackOutput(BACKEND_STACK, "TableArn");
  const tableName = await getStackOutput(BACKEND_STACK, "TableName");
  console.log(`Using DynamoDB table: ${tableName} (${tableArn})`);

  await ensureCdkBootstrap();

  console.log(`\nDeploying ${WATCHER_STACK}...`);
  await cdkDeploy(WATCHER_STACK, "bin/watcher-app.ts");

  console.log("\n=== Watcher deploy complete ===");
  console.log("The watcher Lambda will index on-chain loans to DynamoDB every 5 minutes.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
