"use client";

import { useState } from "react";
import type { DexPoolSnapshot, TreasuryAddrSnapshot } from "@/lib/api";
import styles from "./TokenDistributionChart.module.css";

export interface DistributionSlice {
  label: string;
  value: number;
  color: string;
  subRows?: { label: string; value: number }[];
}

interface Props {
  token: string;
  slices: DistributionSlice[];
  unit: string;
}

function formatAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function PieChart({ slices }: { slices: DistributionSlice[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const total = slices.reduce((s, sl) => s + sl.value, 0);
  if (total === 0) return <div className={styles.noData}>No data yet</div>;

  const SIZE = 200;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const R = 80;
  const INNER_R = 48;

  let cursor = -Math.PI / 2;
  const paths: { d: string; color: string; idx: number }[] = [];

  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i];
    if (slice.value <= 0) continue;

    const frac = slice.value / total;
    const angle = frac * 2 * Math.PI;
    const endAngle = cursor + angle;

    const x1 = CX + R * Math.cos(cursor);
    const y1 = CY + R * Math.sin(cursor);
    const x2 = CX + R * Math.cos(endAngle);
    const y2 = CY + R * Math.sin(endAngle);
    const ix1 = CX + INNER_R * Math.cos(cursor);
    const iy1 = CY + INNER_R * Math.sin(cursor);
    const ix2 = CX + INNER_R * Math.cos(endAngle);
    const iy2 = CY + INNER_R * Math.sin(endAngle);
    const large = angle > Math.PI ? 1 : 0;

    const d = [
      `M ${ix1} ${iy1}`,
      `L ${x1} ${y1}`,
      `A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`,
      `L ${ix2} ${iy2}`,
      `A ${INNER_R} ${INNER_R} 0 ${large} 0 ${ix1} ${iy1}`,
      "Z",
    ].join(" ");

    paths.push({ d, color: slice.color, idx: i });
    cursor = endAngle;
  }

  const hoveredSlice = hovered !== null ? slices[hovered] : null;

  return (
    <div className={styles.chartWrapper}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className={styles.svg}
        aria-label="Token distribution pie chart"
      >
        {paths.map(({ d, color, idx }) => (
          <path
            key={idx}
            d={d}
            fill={color}
            stroke="var(--bg-primary)"
            strokeWidth={hovered === idx ? 3 : 2}
            opacity={hovered === null || hovered === idx ? 1 : 0.45}
            style={{ transition: "opacity 0.15s, stroke-width 0.15s", cursor: "pointer" }}
            onMouseEnter={() => setHovered(idx)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
        {hoveredSlice ? (
          <>
            <text
              x={CX}
              y={CY - 8}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-secondary)"
            >
              {hoveredSlice.label}
            </text>
            <text
              x={CX}
              y={CY + 10}
              textAnchor="middle"
              fontSize={13}
              fontWeight={700}
              fill="var(--text-primary)"
            >
              {((hoveredSlice.value / total) * 100).toFixed(1)}%
            </text>
          </>
        ) : (
          <text
            x={CX}
            y={CY + 5}
            textAnchor="middle"
            fontSize={11}
            fill="var(--text-muted)"
          >
            Hover slice
          </text>
        )}
      </svg>
    </div>
  );
}

export function TokenDistributionChart({ token, slices, unit }: Props) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const total = slices.reduce((s, sl) => s + sl.value, 0);

  return (
    <div className={styles.root}>
      <h3 className={styles.title}>
        <span className={styles.tokenBadge}>{token}</span> Distribution
      </h3>

      <div className={styles.body}>
        <PieChart slices={slices} />

        <div className={styles.table}>
          {slices.map((sl, i) => {
            const pct = total > 0 ? (sl.value / total) * 100 : 0;
            const isExpanded = expandedIdx === i;
            return (
              <div key={sl.label} className={styles.row}>
                <div
                  className={`${styles.rowMain} ${sl.subRows ? styles.rowClickable : ""}`}
                  onClick={() => sl.subRows && setExpandedIdx(isExpanded ? null : i)}
                >
                  <span className={styles.rowLabelCell}>
                    <span className={styles.dot} style={{ background: sl.color }} />
                    <span className={styles.rowLabel}>{sl.label}</span>
                    {sl.subRows && (
                      <span className={styles.expand}>{isExpanded ? "▲" : "▼"}</span>
                    )}
                  </span>
                  <span className={styles.rowValue}>
                    {formatAmount(sl.value)} {unit}
                  </span>
                  <span className={styles.rowPct}>{pct.toFixed(1)}%</span>
                </div>
                {isExpanded && sl.subRows && (
                  <div className={styles.subRows}>
                    {sl.subRows.map((sub) => (
                      <div key={sub.label} className={styles.subRow}>
                        <span className={styles.subLabel} title={sub.label}>
                          {sub.label}
                        </span>
                        <span className={styles.subValue}>
                          {formatAmount(sub.value)} {unit}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div className={styles.totalRow}>
            <span className={styles.totalLabel}>Total supply</span>
            <span className={styles.totalValue}>
              {formatAmount(total)} {unit}
            </span>
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}

// Helpers to convert raw atto-unit strings → display numbers

const ABX_DEC = 9;
const ABD_DEC = 9;

function fromAtto(raw: string, decimals: number): number {
  if (!raw || raw === "0") return 0;
  return Number(BigInt(raw)) / 10 ** decimals;
}

function treasurySubRows(
  addrs: TreasuryAddrSnapshot[] | undefined,
  decimals: number,
): { label: string; value: number }[] | undefined {
  if (!addrs || addrs.length === 0) return undefined;
  return addrs.map((a) => ({
    label: `${a.addr.slice(0, 8)}…${a.addr.slice(-4)}`,
    value: fromAtto(a.amount, decimals),
  }));
}

export function buildAbxSlices(stats: {
  abxTotalSupply: string;
  abxInStaking: string;
  abxInDex: string;
  abxInDexPools: DexPoolSnapshot[];
  abxTreasury: string;
  abxTreasuryAddrs?: TreasuryAddrSnapshot[];
}): DistributionSlice[] {
  const total = fromAtto(stats.abxTotalSupply, ABX_DEC);
  const staking = fromAtto(stats.abxInStaking, ABX_DEC);
  const dex = fromAtto(stats.abxInDex, ABX_DEC);
  const treasury = fromAtto(stats.abxTreasury, ABX_DEC);
  const circulating = Math.max(0, total - staking - dex - treasury);

  return [
    {
      label: "In Staking",
      value: staking,
      color: "#00e676",
    },
    {
      label: "DEX Liquidity",
      value: dex,
      color: "#3b82f6",
      subRows: stats.abxInDexPools.map((p) => ({
        label: p.symbol,
        value: fromAtto(p.reserve, ABX_DEC),
      })),
    },
    {
      label: "Treasury",
      value: treasury,
      color: "#f59e0b",
      subRows: treasurySubRows(stats.abxTreasuryAddrs, ABX_DEC),
    },
    {
      label: "Circulating",
      value: circulating,
      color: "#6b7280",
    },
  ];
}

export function buildAbdSlices(stats: {
  abdTotalSupply: string;
  abdInAuctionPools: string;
  abdInDex: string;
  abdInDexPools: DexPoolSnapshot[];
  abdTreasury: string;
  abdTreasuryAddrs?: TreasuryAddrSnapshot[];
}): DistributionSlice[] {
  const total = fromAtto(stats.abdTotalSupply, ABD_DEC);
  const auctions = fromAtto(stats.abdInAuctionPools, ABD_DEC);
  const dex = fromAtto(stats.abdInDex, ABD_DEC);
  const treasury = fromAtto(stats.abdTreasury, ABD_DEC);
  const circulating = Math.max(0, total - auctions - dex - treasury);

  return [
    {
      label: "Auction Pools",
      value: auctions,
      color: "#f97316",
    },
    {
      label: "DEX Liquidity",
      value: dex,
      color: "#3b82f6",
      subRows: stats.abdInDexPools.map((p) => ({
        label: p.symbol,
        value: fromAtto(p.reserve, ABD_DEC),
      })),
    },
    {
      label: "Treasury",
      value: treasury,
      color: "#f59e0b",
      subRows: treasurySubRows(stats.abdTreasuryAddrs, ABD_DEC),
    },
    {
      label: "Circulating",
      value: circulating,
      color: "#6b7280",
    },
  ];
}
