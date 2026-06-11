import "dotenv/config";
import path from "path";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { fromIni } from "@aws-sdk/credential-providers";
import { execa } from "execa";

// All values can be overridden via .env (see .env.example)
export const AWS_PROFILE  = process.env.AWS_PROFILE  ?? "alphmirrors";
export const AWS_REGION   = process.env.AWS_REGION   ?? "eu-west-3";
export const BACKEND_STACK = process.env.BACKEND_STACK_NAME ?? "AbxBackendStack";
export const WATCHER_STACK = process.env.WATCHER_STACK_NAME ?? "AbxWatcherStack";

const BOOTSTRAP_TEMPLATE = path.join(process.cwd(), "infra", "bootstrap-no-ecr.yaml");

function cfClient() {
  return new CloudFormationClient({
    region: AWS_REGION,
    credentials: fromIni({ profile: AWS_PROFILE }),
  });
}

export async function getStackOutput(stackName: string, key: string): Promise<string | undefined> {
  try {
    const res = await cfClient().send(new DescribeStacksCommand({ StackName: stackName }));
    const stack = res.Stacks?.[0];
    return stack?.Outputs?.find((o) => o.OutputKey === key)?.OutputValue;
  } catch {
    return undefined;
  }
}

export async function stackExists(stackName: string): Promise<boolean> {
  try {
    const res = await cfClient().send(new DescribeStacksCommand({ StackName: stackName }));
    const status = res.Stacks?.[0]?.StackStatus;
    return status === "CREATE_COMPLETE" || status === "UPDATE_COMPLETE";
  } catch {
    return false;
  }
}

async function getBootstrapStatus(): Promise<"complete" | "missing" | "failed"> {
  try {
    const res = await cfClient().send(new DescribeStacksCommand({ StackName: "CDKToolkit" }));
    const status = res.Stacks?.[0]?.StackStatus;
    if (status === "CREATE_COMPLETE" || status === "UPDATE_COMPLETE") return "complete";
    return "failed";
  } catch {
    return "missing";
  }
}

async function getAccountId(): Promise<string> {
  const sts = new STSClient({
    region: AWS_REGION,
    credentials: fromIni({ profile: AWS_PROFILE }),
  });
  const { Account } = await sts.send(new GetCallerIdentityCommand({}));
  if (!Account) throw new Error("Could not determine AWS account ID from profile");
  return Account;
}

export async function ensureCdkBootstrap() {
  console.log("Checking CDK bootstrap status...");
  const status = await getBootstrapStatus();

  if (status === "complete") {
    console.log("CDK already bootstrapped.");
    return;
  }

  if (status === "failed") {
    console.error(
      "CDKToolkit stack exists but is in a failed state (likely from a previous bootstrap attempt).\n" +
      "Delete it first, then re-run deploy:\n\n" +
      `  aws cloudformation delete-stack --stack-name CDKToolkit --profile ${AWS_PROFILE} --region ${AWS_REGION}\n` +
      `  aws cloudformation wait stack-delete-complete --stack-name CDKToolkit --profile ${AWS_PROFILE} --region ${AWS_REGION}\n` +
      "  pnpm deploy:api\n",
    );
    process.exit(1);
  }

  const accountId = await getAccountId();
  console.log(`CDK bootstrap not found — bootstrapping aws://${accountId}/${AWS_REGION} (S3 only, no ECR)...`);
  await execa(
    "pnpm",
    ["--filter", "infra", "exec", "cdk", "bootstrap",
     `aws://${accountId}/${AWS_REGION}`,
     "--profile", AWS_PROFILE,
     "--template", BOOTSTRAP_TEMPLATE,
    ],
    { stdio: "inherit" },
  );
  console.log("Bootstrap complete.");
}

export async function cdkDeploy(stackName: string, appEntry = "bin/backend-app.ts") {
  await execa(
    "pnpm",
    ["--filter", "infra", "exec", "cdk", "deploy", stackName,
     "-a", `npx ts-node --prefer-ts-exts ${appEntry}`,
     "--profile", AWS_PROFILE,
     "--require-approval", "never",
     "--outputs-file", `cdk-outputs-${stackName}.json`,
    ],
    { stdio: "inherit", cwd: process.cwd() },
  );
}
