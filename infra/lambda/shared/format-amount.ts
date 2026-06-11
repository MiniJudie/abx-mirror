/** Format an on-chain token amount to exactly 2 decimal places. */
export function formatAmount2(raw: bigint, decimals = 18): string {
  const num = Number(raw) / 10 ** decimals;
  if (!Number.isFinite(num)) return "0.00";
  return num.toFixed(2);
}
