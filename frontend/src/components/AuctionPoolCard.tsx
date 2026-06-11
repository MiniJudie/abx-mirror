"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuctionPool, AuctionBid } from "@/lib/api";
import { fetchAuctionPoolBids } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import styles from "./AuctionPoolCard.module.css";

interface Props {
  pool: AuctionPool;
}

function truncateAddress(addr: string, start = 6, end = 4): string {
  if (addr.length <= start + end + 3) return addr;
  return `${addr.slice(0, start)}…${addr.slice(-end)}`;
}

function timeAgo(ms: string): string {
  const diff = Date.now() - Number(ms);
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function BidRow({ bid }: { bid: AuctionBid }) {
  return (
    <div className={styles.bidRow}>
      <a
        href={`https://explorer.alephium.org/addresses/${bid.bidderWallet}`}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.bidWallet}
        title={bid.bidderWallet}
      >
        {truncateAddress(bid.bidderWallet)}
      </a>
      <span className={styles.bidAmount}>
        {formatNumber(bid.abdAmount, { maximumFractionDigits: 2 })} ABD
      </span>
      <span className={styles.bidAge}>{timeAgo(bid.createdAt)}</span>
    </div>
  );
}

export function AuctionPoolCard({ pool }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [bids, setBids] = useState<AuctionBid[] | null>(null);
  const [bidsLoading, setBidsLoading] = useState(false);
  const [bidsError, setBidsError] = useState<string | null>(null);

  const handleClose = useCallback(() => setModalOpen(false), []);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) handleClose();
    },
    [handleClose],
  );

  const handleOpen = useCallback(() => {
    setModalOpen(true);
    // Only fetch if not already loaded
    if (bids !== null) return;
    setBidsLoading(true);
    setBidsError(null);
    fetchAuctionPoolBids(pool.discount)
      .then((data) => setBids(data))
      .catch((err) => setBidsError(err.message ?? "Failed to load bids"))
      .finally(() => setBidsLoading(false));
  }, [bids, pool.discount]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen, handleClose]);

  return (
    <>
      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.discountBadge}>
            <span className={styles.discountValue}>{pool.discountPercent}%</span>
            <span className={styles.discountLabel}>POOL</span>
          </div>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>TOTAL ABD</span>
              <span className={styles.statValue}>
                {formatNumber(pool.totalAbdAmount, { maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>BIDS</span>
              <span className={styles.statValue}>
                {formatNumber(pool.bidCount, { maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>
        </div>

        {pool.bidCount > 0 && (
          <button className={styles.expandBtn} onClick={handleOpen}>
            {`Show ${formatNumber(pool.bidCount, { maximumFractionDigits: 0 })} bid${pool.bidCount !== 1 ? "s" : ""}`}
          </button>
        )}

        {pool.bidCount === 0 && (
          <p className={styles.emptyPool}>No active bids in this pool</p>
        )}
      </div>

      {modalOpen && (
        <div className={styles.backdrop} onClick={handleBackdropClick}>
          <div
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`pool-bids-title-${pool.discount}`}
          >
            <div className={styles.dialogHeader}>
              <div>
                <span className={styles.dialogEyebrow}>{pool.discountPercent}% Pool</span>
                <h3
                  className={styles.dialogTitle}
                  id={`pool-bids-title-${pool.discount}`}
                >
                  {formatNumber(pool.bidCount, { maximumFractionDigits: 0 })} Active Bid
                  {pool.bidCount !== 1 ? "s" : ""}
                </h3>
              </div>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={handleClose}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className={styles.bidsContainer}>
              {bidsLoading && (
                <div className={styles.bidsLoading}>Loading bids…</div>
              )}
              {bidsError && (
                <div className={styles.bidsError}>{bidsError}</div>
              )}
              {!bidsLoading && !bidsError && bids !== null && bids.length > 0 && (
                <>
                  <div className={styles.bidsHeader}>
                    <span>Wallet</span>
                    <span>Amount</span>
                    <span>Age</span>
                  </div>
                  {bids.map((bid) => (
                    <BidRow key={bid.bidAddress} bid={bid} />
                  ))}
                </>
              )}
              {!bidsLoading && !bidsError && bids !== null && bids.length === 0 && (
                <div className={styles.bidsLoading}>No bids found.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
