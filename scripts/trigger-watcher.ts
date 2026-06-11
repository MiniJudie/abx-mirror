#!/usr/bin/env tsx
/**
 * pnpm trigger:watcher
 * Manually invokes the Watcher Lambda (same handler as the 5-minute schedule).
 */
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { fromIni } from "@aws-sdk/credential-providers";
import { AWS_PROFILE, AWS_REGION, WATCHER_STACK, getStackOutput, stackExists } from "./utils.js";

async function main() {
  console.log("=== Trigger: ABX Watcher Lambda ===\n");

  const deployed = await stackExists(WATCHER_STACK);
  if (!deployed) {
    console.error(
      `Error: ${WATCHER_STACK} is not deployed yet.\n` +
      `Run \`pnpm deploy:watcher\` first, then re-run \`pnpm trigger:watcher\`.`,
    );
    process.exit(1);
  }

  const functionArn = await getStackOutput(WATCHER_STACK, "WatcherFunctionArn");
  if (!functionArn) {
    console.error(`Error: WatcherFunctionArn output not found on ${WATCHER_STACK}.`);
    process.exit(1);
  }

  console.log(`Invoking ${functionArn}...`);

  const lambda = new LambdaClient({
    region: AWS_REGION,
    credentials: fromIni({ profile: AWS_PROFILE }),
  });

  const res = await lambda.send(new InvokeCommand({
    FunctionName: functionArn,
    InvocationType: "RequestResponse",
    LogType: "Tail",
  }));

  if (res.LogResult) {
    const logs = Buffer.from(res.LogResult, "base64").toString("utf8");
    console.log("\n--- Lambda logs ---");
    console.log(logs.trimEnd());
    console.log("--- end logs ---\n");
  }

  if (res.FunctionError) {
    const payload = res.Payload ? Buffer.from(res.Payload).toString("utf8") : "";
    console.error(`Lambda failed (${res.FunctionError})`);
    if (payload) console.error(payload);
    process.exit(1);
  }

  console.log("Watcher run complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
