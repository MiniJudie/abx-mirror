"use client";

import type { ReactNode } from "react";
import type { Loan } from "@/lib/api";
import { formatTokenAmount, formatAlphUsdPrice, formatUsdCompact } from "@/lib/format";
import { TokenIcon } from "./TokenIcon";
import styles from "./StatsBar.module.css";

interface Props {
  loans: Loan[];
  loading: boolean;
  abdPrice: string | null;
  alphPrice: string | null;
  priceLoading: boolean;
}

function sumCollateral(loans: Loan[]): number {
  return loans.reduce((acc, l) => acc + (parseFloat(l.collateral) || 0), 0);
}

function sumDebt(loans: Loan[]): number {
  return loans.reduce((acc, l) => acc + (parseFloat(l.debt) || 0), 0);
}

function formatM(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return formatTokenAmount(value);
}

function TokenStatValue({
  amount,
  symbol,
}: {
  amount: string;
  symbol: "ALPH" | "ABD";
}) {
  return (
    <span className={styles.tokenStatValue}>
      {amount}
      <TokenIcon symbol={symbol} size={18} showSymbol />
    </span>
  );
}

const STATS_CONFIG = [
  { key: "supply", label: "TOTAL SUPPLY", token: "ALPH" as const },
  { key: "borrow", label: "TOTAL BORROW", token: "ABD" as const },
  { key: "tvl", label: "TOTAL VALUE LOCKED", token: "ALPH" as const },
  { key: "alphPrice", label: "ALPH PRICE", token: "ALPH" as const },
  { key: "abdPrice", label: "ABD PRICE", token: "ABD" as const },
] as const;

export function StatsBar({ loans, loading, abdPrice, alphPrice, priceLoading }: Props) {
  const collateral = sumCollateral(loans);
  const debt = sumDebt(loans);
  const alphUsd = alphPrice ? parseFloat(alphPrice) : null;

  const values: Record<string, { primary: ReactNode; secondary?: string }> = {
    supply: {
      primary: loading ? "…" : <TokenStatValue amount={`${formatM(collateral)}`} symbol="ALPH" />,
      secondary:
        loading || !alphUsd
          ? "Indexed on-chain"
          : formatUsdCompact(collateral * alphUsd),
    },
    borrow: {
      primary: loading ? "…" : <TokenStatValue amount={`${formatM(debt)}`} symbol="ABD" />,
      secondary: "Indexed on-chain",
    },
    tvl: {
      primary: loading ? "…" : <TokenStatValue amount={`${formatM(collateral)}`} symbol="ALPH" />,
      secondary:
        loading || !alphUsd
          ? "Total collateral"
          : formatUsdCompact(collateral * alphUsd),
    },
    alphPrice: {
      primary: priceLoading ? "…" : alphPrice ? formatAlphUsdPrice(alphPrice) : "—",
      secondary: "Oracle price",
    },
    abdPrice: {
      primary: priceLoading ? "…" : abdPrice ? `$${abdPrice}` : "—",
      secondary: "Oracle price",
    },
  };

  return (
    <section className={styles.bar}>
      <div className={styles.inner}>
        {STATS_CONFIG.map((stat) => {
          const v = values[stat.key];
          return (
            <div key={stat.key} className={styles.stat}>
              <div className={styles.statContent}>
                <span className={styles.statLabel}>{stat.label}</span>
                <span className={styles.statValue}>{v.primary}</span>
                {v.secondary && <span className={styles.statSub}>{v.secondary}</span>}
              </div>
              <span className={styles.statIcon} aria-hidden>
                <TokenIcon symbol={stat.token} size={28} />
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
