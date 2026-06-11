"use client";

import { useEffect, useState } from "react";
import type { LiquidationEvent } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import styles from "./LiquidationHistory.module.css";

interface Props {
  liquidations: LiquidationEvent[];
}

const PAGE_SIZE = 25;

function truncateAddress(addr: string, start = 6, end = 4): string {
  if (addr.length <= start + end + 3) return addr;
  return `${addr.slice(0, start)}…${addr.slice(-end)}`;
}

function formatTimestamp(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type SortKey = "timestamp" | "abdLiquidated" | "alphReward" | "discount";
type SortDir = "asc" | "desc";

function sortLiquidations(
  items: LiquidationEvent[],
  key: SortKey,
  dir: SortDir,
): LiquidationEvent[] {
  return [...items].sort((a, b) => {
    let va: number;
    let vb: number;
    if (key === "timestamp") {
      va = a.timestamp ?? 0;
      vb = b.timestamp ?? 0;
    } else if (key === "discount") {
      va = a.discount ?? -1;
      vb = b.discount ?? -1;
    } else {
      va = parseFloat(a[key] ?? "0") || 0;
      vb = parseFloat(b[key] ?? "0") || 0;
    }
    if (va < vb) return dir === "asc" ? -1 : 1;
    if (va > vb) return dir === "asc" ? 1 : -1;
    return 0;
  });
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "abdLiquidated", label: "ABD Liquidated" },
  { key: "alphReward", label: "ALPH Reward" },
  { key: "discount", label: "Discount" },
  { key: "timestamp", label: "Time" },
];

const NUMERIC_COLUMNS = new Set<SortKey>(["abdLiquidated", "alphReward", "discount"]);

function AddressLink({ addr, className }: { addr: string; className?: string }) {
  return (
    <a
      href={`https://explorer.alephium.org/addresses/${addr}`}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={addr}
    >
      {addr}
    </a>
  );
}

interface DetailModalProps {
  liq: LiquidationEvent;
  onClose: () => void;
}

function DetailModal({ liq, onClose }: DetailModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>Liquidation Details</span>
          <button className={styles.modalClose} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.modalSection}>
            <span className={styles.modalSectionLabel}>Transaction</span>
            <a
              href={`https://explorer.alephium.org/transactions/${liq.txId}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.modalValue} ${styles.modalLink}`}
              title={liq.txId}
            >
              {liq.txId}↗
            </a>
          </div>

          <div className={styles.modalSection}>
            <span className={styles.modalSectionLabel}>Time</span>
            <span className={styles.modalValue}>{formatTimestamp(liq.timestamp)}</span>
          </div>

          <div className={styles.modalDivider} />

          <div className={styles.modalSection}>
            <span className={styles.modalSectionLabel}>Loan Contract</span>
            <AddressLink addr={liq.loan} className={`${styles.modalValue} ${styles.modalLink}`} />
          </div>

          <div className={styles.modalSection}>
            <span className={styles.modalSectionLabel}>Borrower</span>
            <AddressLink addr={liq.loanOwner} className={`${styles.modalValue} ${styles.modalLink}`} />
          </div>

          <div className={styles.modalSection}>
            <span className={styles.modalSectionLabel}>Liquidator</span>
            {liq.liquidator ? (
              <AddressLink addr={liq.liquidator} className={`${styles.modalValue} ${styles.modalLink}`} />
            ) : (
              <span className={`${styles.modalValue} ${styles.modalMuted}`}>—</span>
            )}
          </div>

          <div className={styles.modalSection}>
            <span className={styles.modalSectionLabel}>Auction Owner</span>
            {liq.auctionOwner ? (
              <AddressLink addr={liq.auctionOwner} className={`${styles.modalValue} ${styles.modalLink}`} />
            ) : (
              <span className={`${styles.modalValue} ${styles.modalMuted}`}>—</span>
            )}
          </div>

          <div className={styles.modalDivider} />

          <div className={styles.modalSection}>
            <span className={styles.modalSectionLabel}>New Collateral</span>
            <span className={styles.modalValue}>
              {formatNumber(liq.newCollateral, { maximumFractionDigits: 4 })}{" "}
              <span className={styles.modalUnit}>ALPH</span>
            </span>
          </div>

          <div className={styles.modalSection}>
            <span className={styles.modalSectionLabel}>New Debt</span>
            <span className={styles.modalValue}>
              {formatNumber(liq.newDebt, { maximumFractionDigits: 2 })}{" "}
              <span className={styles.modalUnit}>ABD</span>
            </span>
          </div>

          <div className={styles.modalSection}>
            <span className={styles.modalSectionLabel}>ABD Liquidated</span>
            <span className={styles.modalValue}>
              {liq.abdLiquidated != null ? (
                <>
                  {formatNumber(liq.abdLiquidated, { maximumFractionDigits: 2 })}{" "}
                  <span className={styles.modalUnit}>ABD</span>
                </>
              ) : (
                <span className={styles.modalMuted}>—</span>
              )}
            </span>
          </div>

          <div className={styles.modalSection}>
            <span className={styles.modalSectionLabel}>ALPH Reward</span>
            <span className={styles.modalValue}>
              {liq.alphReward != null ? (
                <>
                  {formatNumber(liq.alphReward, { maximumFractionDigits: 4 })}{" "}
                  <span className={styles.modalUnit}>ALPH</span>
                </>
              ) : (
                <span className={styles.modalMuted}>—</span>
              )}
            </span>
          </div>

          <div className={styles.modalSection}>
            <span className={styles.modalSectionLabel}>Discount</span>
            <span className={styles.modalValue}>
              {liq.discount != null ? (
                <span className={styles.discount}>{liq.discount}%</span>
              ) : (
                <span className={styles.modalMuted}>—</span>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LiquidationHistory({ liquidations }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [selectedLiq, setSelectedLiq] = useState<LiquidationEvent | null>(null);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  }

  const sorted = sortLiquidations(liquidations, sortKey, sortDir);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageItems = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <>
      <div className={styles.container}>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Borrower</th>
                <th className={styles.th}>Liquidator</th>
                <th className={styles.th}>Auction Owner</th>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`${styles.th} ${styles.thSortable} ${NUMERIC_COLUMNS.has(col.key) ? styles.numCell : ""}`}
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}
                    <span className={styles.sortIndicator}>
                      {sortKey === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                    </span>
                  </th>
                ))}
                <th className={styles.th}>Tx</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className={styles.emptyRow}>
                    No liquidations recorded yet
                  </td>
                </tr>
              ) : (
                pageItems.map((liq) => (
                  <tr
                    key={liq.txId}
                    className={`${styles.row} ${styles.rowClickable}`}
                    onClick={() => setSelectedLiq(liq)}
                    title="Click to see full details"
                  >
                    <td className={styles.td}>
                      <a
                        href={`https://explorer.alephium.org/addresses/${liq.loanOwner}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.addrLink}
                        title={liq.loanOwner}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {truncateAddress(liq.loanOwner)}
                      </a>
                    </td>
                    <td className={styles.td}>
                      {liq.liquidator ? (
                        <a
                          href={`https://explorer.alephium.org/addresses/${liq.liquidator}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.addrLink}
                          title={liq.liquidator}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {truncateAddress(liq.liquidator)}
                        </a>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td className={styles.td}>
                      {liq.auctionOwner ? (
                        <a
                          href={`https://explorer.alephium.org/addresses/${liq.auctionOwner}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.addrLink}
                          title={liq.auctionOwner}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {truncateAddress(liq.auctionOwner)}
                        </a>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td className={`${styles.td} ${styles.numCell}`}>
                      {liq.abdLiquidated != null ? (
                        <>
                          <span className={styles.mono}>
                            {formatNumber(liq.abdLiquidated, { maximumFractionDigits: 2 })}
                          </span>
                          <span className={styles.unit}> ABD</span>
                        </>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td className={`${styles.td} ${styles.numCell}`}>
                      {liq.alphReward != null ? (
                        <>
                          <span className={styles.mono}>
                            {formatNumber(liq.alphReward, { maximumFractionDigits: 4 })}
                          </span>
                          <span className={styles.unit}> ALPH</span>
                        </>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td className={`${styles.td} ${styles.numCell}`}>
                      {liq.discount != null ? (
                        <span className={styles.discount}>{liq.discount}%</span>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td className={styles.td}>
                      <span className={styles.time}>{formatTimestamp(liq.timestamp)}</span>
                    </td>
                    <td className={styles.td}>
                      <a
                        href={`https://explorer.alephium.org/transactions/${liq.txId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.txLink}
                        title={liq.txId}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {truncateAddress(liq.txId, 6, 4)}↗
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className={styles.pagination}>
            <button
              className={styles.pageBtn}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              ← Prev
            </button>
            <span className={styles.pageInfo}>
              Page {formatNumber(page + 1, { maximumFractionDigits: 0 })} of{" "}
              {formatNumber(totalPages, { maximumFractionDigits: 0 })}
            </span>
            <button
              className={styles.pageBtn}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {selectedLiq && (
        <DetailModal liq={selectedLiq} onClose={() => setSelectedLiq(null)} />
      )}
    </>
  );
}
