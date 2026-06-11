/** Liquidation when collateral USD is below 200% of debt USD. */
export const LIQUIDATION_LTV_PERCENT = 200;

export const LTV_RISK_TIERS = [
  {
    label: "Liquidation",
    min: 0,
    max: 200,
    color: "var(--status-undercollateralized)",
    sort: 0,
  },
  {
    label: "High risk",
    min: 200,
    max: 230,
    color: "var(--status-auction)",
    sort: 1,
  },
  {
    label: "Aggressive",
    min: 230,
    max: 280,
    color: "var(--status-risky)",
    sort: 2,
  },
  {
    label: "Moderate",
    min: 280,
    max: 400,
    color: "var(--status-active)",
    sort: 3,
  },
  {
    label: "Conservative",
    min: 400,
    max: Infinity,
    color: "var(--accent-green)",
    sort: 4,
  },
] as const;

export type LtvRiskTier = (typeof LTV_RISK_TIERS)[number];

/** @deprecated Use LIQUIDATION_LTV_PERCENT — kept for liquidation price math (ratio = 2.0). */
export const LIQUIDATION_CR = LIQUIDATION_LTV_PERCENT / 100;

export function parseAmount(value: string): number {
  return parseFloat(value) || 0;
}

export function parsePrice(value: string | null): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** LTV = collateral USD / debt USD, as a percentage (liquidation below 200%). */
export function loanLtvPercent(
  debt: string,
  collateral: string,
  abdUsd: string | null,
  alphUsd: string | null,
): number | null {
  const abd = parsePrice(abdUsd);
  const alph = parsePrice(alphUsd);
  if (abd === null || alph === null) return null;

  const debtUsd = parseAmount(debt) * abd;
  const collateralUsd = parseAmount(collateral) * alph;
  if (debtUsd === 0) return null;

  return (collateralUsd / debtUsd) * 100;
}

/** Collateral ratio as a multiplier (e.g. 2.12× at 212% LTV). */
export function loanCollateralRatio(
  debt: string,
  collateral: string,
  abdUsd: string | null,
  alphUsd: string | null,
): number | null {
  const ltv = loanLtvPercent(debt, collateral, abdUsd, alphUsd);
  if (ltv === null) return null;
  return ltv / 100;
}

export function getLtvRiskTier(ltvPercent: number): LtvRiskTier {
  for (const tier of LTV_RISK_TIERS) {
    if (ltvPercent >= tier.min && ltvPercent < tier.max) return tier;
  }
  return LTV_RISK_TIERS[LTV_RISK_TIERS.length - 1];
}

/** Map LTV 100%–400% to a 0–100 bar width. */
export function ltvBarWidth(ltvPercent: number): number {
  const min = 100;
  const max = 400;
  return Math.min(100, Math.max(0, ((ltvPercent - min) / (max - min)) * 100));
}

/** ALPH USD price at which the loan hits the 200% LTV liquidation threshold. */
export function loanLiquidationPrice(
  debt: string,
  collateral: string,
  abdUsd: string | null,
  liquidationLtvPercent = LIQUIDATION_LTV_PERCENT,
): number | null {
  const abd = parsePrice(abdUsd);
  if (abd === null) return null;

  const debtAmount = parseAmount(debt);
  const collateralAmount = parseAmount(collateral);
  if (collateralAmount === 0 || debtAmount === 0) return null;

  return (debtAmount * abd * (liquidationLtvPercent / 100)) / collateralAmount;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatRatio(value: number): string {
  return `${value.toFixed(2)}×`;
}

export function formatUsdPrice(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

export function parseInterestPercent(value: string): number | null {
  const normalized = value.replace("%", "").trim();
  if (!normalized) return null;
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Show 0% when borrowed with zero interest; hide legacy fixed-point zeros with no debt. */
export function displayInterestRate(stored: string, debt: string): string {
  const hasDebt = parseAmount(debt) > 0;
  const parsed = parseInterestPercent(stored);

  if (hasDebt && parsed === 0) return "0%";

  if (stored === "0.00%" || stored === "0.0000%") {
    return hasDebt ? "0%" : "—";
  }

  if (!stored || stored === "—") return "—";
  return stored;
}
