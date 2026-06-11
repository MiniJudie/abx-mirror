"use client";

import { sendEvent } from "@socialgouv/matomo-next";
import type { Loan } from "@/lib/api";
import { displayInterestRate } from "@/lib/loan-metrics";
import { TokenIcon } from "./TokenIcon";
import styles from "./LoanCard.module.css";

const CR_ZONE_COLORS: Record<Loan["crZone"], string> = {
  Active: "var(--status-active)",
  Risky: "var(--status-risky)",
  Auction: "var(--status-auction)",
  Undercollateralized: "var(--status-undercollateralized)",
};

function truncate(addr: string, start = 8, end = 6): string {
  if (addr.length <= start + end + 3) return addr;
  return `${addr.slice(0, start)}…${addr.slice(-end)}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface Props {
  loan: Loan;
}

export function LoanCard({ loan }: Props) {
  const zoneColor = CR_ZONE_COLORS[loan.crZone] ?? "var(--text-secondary)";
  const explorerUrl = `https://explorer.alephium.org/addresses/${loan.loanAddress}`;

  return (
    <a
      href={explorerUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.card}
      onClick={() => sendEvent({ category: "loan", action: "view_on_explorer", name: loan.loanAddress })}
    >
      <div className={styles.topRow}>
        <span className={styles.label}>LOAN</span>
        <span className={styles.badge} style={{ color: zoneColor, borderColor: zoneColor }}>
          <span className={styles.dot} style={{ background: zoneColor }} />
          {loan.crZone.toUpperCase()}
        </span>
      </div>

      <div className={styles.address} title={loan.loanAddress}>
        {truncate(loan.loanAddress)}
      </div>

      <div className={styles.divider} />

      <div className={styles.row}>
        <span className={styles.fieldLabel}>Owner</span>
        <span className={styles.fieldValue} title={loan.owner}>
          {truncate(loan.owner)}
        </span>
      </div>

      <div className={styles.row}>
        <span className={styles.fieldLabel}>Collateral</span>
        <span className={styles.fieldValueHighlight}>
          {loan.collateral}
          <TokenIcon symbol="ALPH" size={14} showSymbol />
        </span>
      </div>

      <div className={styles.row}>
        <span className={styles.fieldLabel}>Debt</span>
        <span className={styles.fieldValue}>
          {loan.debt}
          <TokenIcon symbol="ABD" size={14} showSymbol />
        </span>
      </div>

      <div className={styles.row}>
        <span className={styles.fieldLabel}>Interest Rate</span>
        <span className={styles.fieldValue}>
          {displayInterestRate(loan.interestRate, loan.debt)}
        </span>
      </div>

      <div className={styles.footer}>
        <span className={styles.updated}>Updated {timeAgo(loan.lastUpdated)}</span>
        <span className={styles.explorerLink}>View on Explorer ↗</span>
      </div>
    </a>
  );
}
