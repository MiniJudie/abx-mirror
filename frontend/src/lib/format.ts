const US_NUMBER_FORMAT = "en-US" as const;

export function formatNumber(
  value: string | number,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number },
): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(US_NUMBER_FORMAT, {
    minimumFractionDigits: options?.minimumFractionDigits,
    maximumFractionDigits: options?.maximumFractionDigits,
  });
}

export function formatTokenAmount(value: string | number): string {
  return formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatAlphUsdPrice(value: string | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return "$0.000000";
  return `$${n.toFixed(6)}`;
}

export function formatUsdCompact(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

export function toUsd(amount: string, priceUsd: string | null): string | null {
  if (!priceUsd) return null;
  const value = parseFloat(amount) * parseFloat(priceUsd);
  if (!Number.isFinite(value)) return null;
  return formatUsdCompact(value);
}
