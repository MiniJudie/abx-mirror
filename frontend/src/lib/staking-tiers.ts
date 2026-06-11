export type StakingTier = "Banxer" | "Diamond" | "Gold" | "Silver" | "Bronze" | "No Tier";

interface TierDef {
  tier: StakingTier;
  min: number;
}

const TIERS: TierDef[] = [
  { tier: "Banxer",  min: 250_000 },
  { tier: "Diamond", min: 200_000 },
  { tier: "Gold",    min: 150_000 },
  { tier: "Silver",  min: 100_000 },
  { tier: "Bronze",  min:  50_000 },
];

export function getStakingTier(stakedAbx: string): StakingTier {
  const n = parseFloat(stakedAbx) || 0;
  return TIERS.find((t) => n >= t.min)?.tier ?? "No Tier";
}

export { TIERS };
