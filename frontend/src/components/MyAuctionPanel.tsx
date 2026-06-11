"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SignerProvider } from "@alephium/web3";
import {
  fetchUserAuctionPositions,
  type UserBidPosition,
} from "@/lib/api";
import { cancelBidTx } from "@/lib/auction-actions";
import { formatNumber } from "@/lib/format";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { usePendingTx } from "@/hooks/usePendingTx";
import { CreateBidModal } from "./CreateBidModal";
import styles from "./MyAuctionPanel.module.css";

interface Props {
  walletAddress: string;
  signer: SignerProvider;
  onPositionsRefetch: () => void;
}

const STATUS_LABEL: Record<UserBidPosition["bidStatus"], string> = {
  open: "Active",
  completed: "Filled",
  canceled: "Canceled",
};

const STATUS_CLASS: Record<UserBidPosition["bidStatus"], string> = {
  open: styles.statusOpen,
  completed: styles.statusFilled,
  canceled: styles.statusCanceled,
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function truncateAddress(addr: string, start = 6, end = 4): string {
  if (addr.length <= start + end + 3) return addr;
  return `${addr.slice(0, start)}…${addr.slice(-end)}`;
}

export function MyAuctionPanel({
  walletAddress,
  signer,
  onPositionsRefetch,
}: Props) {
  const [positions, setPositions] = useState<UserBidPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [pendingOp, setPendingOp] = useState<{ txId: string; label: string } | null>(null);

  const { alphBalance, abdBalance, loading: balanceLoading, refresh: refreshBalances } =
    useWalletBalances(walletAddress);

  const loadPositions = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchUserAuctionPositions(walletAddress)
      .then((data) => setPositions(data.positions))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load positions"),
      )
      .finally(() => setLoading(false));
  }, [walletAddress]);

  useEffect(() => {
    loadPositions();
  }, [loadPositions]);

  const { status: pendingStatus } = usePendingTx(
    pendingOp?.txId ?? null,
    () => {
      refreshBalances();
      loadPositions();
      onPositionsRefetch();
    },
  );

  useEffect(() => {
    if (pendingStatus === "confirmed") {
      const t = setTimeout(() => setPendingOp(null), 3000);
      return () => clearTimeout(t);
    }
  }, [pendingStatus]);

  const openTotal = useMemo(
    () =>
      positions
        .filter((p) => p.bidStatus === "open")
        .reduce((acc, p) => acc + (parseFloat(p.abdAmount) || 0), 0),
    [positions],
  );

  function handleBidSuccess(txId: string) {
    setPendingOp({ txId, label: "Place bid" });
  }

  async function handleCancel(position: UserBidPosition) {
    if (position.bidStatus !== "open" || !position.bidIndex) return;
    if (
      !window.confirm(
        `Cancel your ${position.discountPercent}% pool bid of ${formatNumber(position.abdAmount, { maximumFractionDigits: 2 })} ABD?`,
      )
    ) {
      return;
    }

    setCancelingId(position.bidAddress);
    try {
      const txId = await cancelBidTx(
        signer,
        walletAddress,
        position.discountPercent,
        position.bidIndex,
      );
      setPendingOp({ txId, label: "Cancel bid" });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to cancel bid";
      window.alert(msg.length > 200 ? msg.slice(0, 200) + "…" : msg);
    } finally {
      setCancelingId(null);
    }
  }

  function openBidModal() {
    refreshBalances();
    setModalOpen(true);
  }

  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        {!loading && !error ? (
          <p className={styles.summary}>
            <strong>
              {formatNumber(openTotal, { maximumFractionDigits: 2 })} ABD
            </strong>
            {" in "}
            {positions.filter((p) => p.bidStatus === "open").length} open bid
            {positions.filter((p) => p.bidStatus === "open").length !== 1 ? "s" : ""}
          </p>
        ) : (
          <p className={styles.summary}>Loading positions…</p>
        )}
        <button type="button" className={styles.placeBtn} onClick={openBidModal}>
          Place Bid
        </button>
      </div>

      {loading && <div className={styles.loading}>Loading your positions…</div>}

      {error && (
        <div className={styles.empty}>
          <span>{error}</span>
          <button type="button" className={styles.placeBtn} onClick={loadPositions}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && positions.length === 0 && (
        <div className={styles.empty}>
          No bids yet. Place ABD in a pool to participate in liquidations.
        </div>
      )}

      {!loading && !error && positions.length > 0 && (
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span>Pool</span>
            <span>Amount</span>
            <span>Status</span>
            <span>Placed</span>
            <span>Bid</span>
            <span>Action</span>
          </div>
          {positions.map((position) => (
            <div key={position.bidAddress} className={styles.tableRow}>
              <span className={styles.poolBadge}>{position.discountPercent}%</span>
              <span className={styles.amount}>
                {formatNumber(position.abdAmount, { maximumFractionDigits: 2 })}{" "}
                ABD
              </span>
              <span className={STATUS_CLASS[position.bidStatus]}>
                {STATUS_LABEL[position.bidStatus]}
              </span>
              <span className={styles.date}>{timeAgo(position.recordedAt)}</span>
              <a
                href={`https://explorer.alephium.org/addresses/${position.bidAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.bidLink}
                title={position.bidAddress}
              >
                {truncateAddress(position.bidAddress)}
              </a>
              {position.bidStatus === "open" ? (
                position.bidIndex ? (
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    onClick={() => handleCancel(position)}
                    disabled={cancelingId === position.bidAddress}
                  >
                    {cancelingId === position.bidAddress ? "…" : "Cancel"}
                  </button>
                ) : (
                  <span className={styles.noCancel} title="Reindex required">
                    —
                  </span>
                )
              ) : (
                <span className={styles.noCancel}>—</span>
              )}
            </div>
          ))}
        </div>
      )}

      {pendingOp && (
        <div
          className={`${styles.pendingBanner} ${pendingStatus === "confirmed" ? styles.pendingBannerConfirmed : ""}`}
        >
          <span className={styles.pendingIcon}>
            {pendingStatus === "confirmed" ? "✓" : <span className={styles.pendingSpinner} />}
          </span>
          <span className={styles.pendingText}>
            {pendingStatus === "confirmed"
              ? `${pendingOp.label} confirmed!`
              : `${pendingOp.label} pending…`}
          </span>
          <a
            href={`https://explorer.alephium.org/transactions/${pendingOp.txId}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.pendingTxLink}
          >
            {pendingOp.txId.slice(0, 8)}…
          </a>
          <button
            type="button"
            className={styles.pendingDismiss}
            onClick={() => setPendingOp(null)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {modalOpen && (
        <CreateBidModal
          walletAddress={walletAddress}
          signer={signer}
          abdBalance={abdBalance}
          balanceLoading={balanceLoading}
          onClose={() => setModalOpen(false)}
          onSuccess={handleBidSuccess}
        />
      )}
    </section>
  );
}
