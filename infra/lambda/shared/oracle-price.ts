import { addressFromContractId, NodeProvider, web3 } from "@alephium/web3";
import { FixedAbdPriceOracle } from "../../../artifacts/artifacts/ts/FixedAbdPriceOracle";
import { DIAAlphPriceAdapter } from "../../../artifacts/artifacts/ts/DIAAlphPriceAdapter";
import { PlatformSettings } from "../../../artifacts/artifacts/ts/PlatformSettings";
import mainnetDeployments from "../../contracts/deployments.mainnet.json";

const NODE_URL = process.env.NODE_URL ?? "https://node.mainnet.alphscan.io";
const SCALE = 10n ** 18n;

export function formatUsdPrice(raw: bigint): string {
  const usd = Number(raw) / Number(SCALE);
  if (!Number.isFinite(usd)) return "0.00";
  return usd.toFixed(2);
}

export function formatAlphUsdPrice(raw: bigint): string {
  const usd = Number(raw) / Number(SCALE);
  if (!Number.isFinite(usd)) return "0.000000";
  return usd.toFixed(6);
}

export async function fetchOraclePrices(): Promise<{ abdUsd: string; alphUsd: string }> {
  const nodeProvider = new NodeProvider(NODE_URL);
  web3.setCurrentNodeProvider(nodeProvider);

  const settingsAddress =
    mainnetDeployments.contracts.PlatformSettings.contractInstance.address;
  const settings = PlatformSettings.at(settingsAddress);

  const [abdOracleId, alphOracleId] = await Promise.all([
    settings.view.getAbdOracleId().then((r) => r.returns as string),
    settings.view.getAlphOracleId().then((r) => r.returns as string),
  ]);

  const abdOracle = FixedAbdPriceOracle.at(addressFromContractId(abdOracleId));
  const alphOracle = DIAAlphPriceAdapter.at(addressFromContractId(alphOracleId));

  const [abdRaw, alphRaw] = await Promise.all([
    abdOracle.view.getUsdInOneAbd().then((r) => r.returns as bigint),
    alphOracle.view.getUsdInOneAlph().then((r) => r.returns as bigint),
  ]);

  return {
    abdUsd: formatUsdPrice(abdRaw),
    alphUsd: formatAlphUsdPrice(alphRaw),
  };
}
