/** Resolve on-chain interest rate field to annual percentage. */
export function resolveInterestRatePercent(index: bigint, allRates: bigint[]): number {
  const n = Number(index);
  if (n < allRates.length) {
    return Number(allRates[n]);
  }
  return n;
}

export function formatInterestRate(index: bigint, allRates: bigint[]): string {
  return `${resolveInterestRatePercent(index, allRates)}%`;
}
