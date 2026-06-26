"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@alephium/web3-react";
import { fetchStakerByOwner, reindexStakerPosition, type StakingPosition } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { getStakingTier, type StakingTier } from "@/lib/staking-tiers";
import {
  claimStakerAlph,
  claimVestingAbx,
  pollTxStatus,
} from "@/lib/stake-actions";
import { StakeModal } from "./StakeModal";
import { UnstakeModal } from "./UnstakeModal";
import styles from "./MyStakingPanel.module.css";

const EXPLORER_TX_URL = "https://explorer.alephium.org/transactions";
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 40; // ~2 min

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

type TxPhase = "mempool" | "confirmed" | "failed";
interface PendingTx { txId: string; phase: TxPhase }

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

function truncateAddress(addr: string, start = 8, end = 6): string {
  if (addr.length <= start + end + 3) return addr;
  return `${addr.slice(0, start)}…${addr.slice(-end)}`;
}

function fmt(val: string, decimals = 4): string {
  return formatNumber(val, { maximumFractionDigits: decimals });
}

function canUnstake(position: StakingPosition): boolean {
  return parseFloat(position.stakedAbx) > 0;
}

function canClaimAlph(position: StakingPosition): boolean {
  return parseFloat(position.claimableAlph) > 0;
}

function claimableAbxAmount(position: StakingPosition): number {
  const withdrawable = parseFloat(position.withdrawableAbx) || 0;
  const afterUnlock = parseFloat(position.withdrawableAfterUnlockAbx) || 0;
  const unlockReady =
    !position.nextUnlockAt || new Date(position.nextUnlockAt).getTime() <= Date.now();
  return withdrawable + (unlockReady ? afterUnlock : 0);
}

function canClaimVesting(position: StakingPosition): boolean {
  return claimableAbxAmount(position) > 0;
}

// ─────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────

function TxProgressBanner({ tx }: { tx: PendingTx }) {
  const cls =
    tx.phase === "confirmed" ? styles.txBannerConfirmed
    : tx.phase === "failed"  ? styles.txBannerFailed
    : styles.txBannerPending;
  const label =
    tx.phase === "confirmed" ? "Transaction confirmed — refreshing your position…"
    : tx.phase === "failed"  ? "Transaction failed or not found."
    : "Transaction in mempool…";
  return (
    <div className={`${styles.txBanner} ${cls}`}>
      {tx.phase === "mempool" && <span className={styles.txSpinner} />}
      {tx.phase !== "mempool" && (
        <span className={styles.txIcon}>{tx.phase === "confirmed" ? "✓" : "✕"}</span>
      )}
      <span className={styles.txLabel}>{label}</span>
      <a href={`${EXPLORER_TX_URL}/${tx.txId}`} target="_blank" rel="noopener noreferrer"
        className={styles.txExplorerLink}>
        Explorer →
      </a>
    </div>
  );
}

function StatusBadge({ status }: { status: StakingPosition["status"] }) {
  const cls = status === "active" ? styles.badgeActive
    : status === "vesting" ? styles.badgeVesting
    : styles.badgeWithdrawable;
  const label = status === "active" ? "ACTIVE" : status === "vesting" ? "VESTING" : "WITHDRAWABLE";
  return <span className={`${styles.badge} ${cls}`}>{label}</span>;
}

function TierBadge({ tier }: { tier: StakingTier }) {
  const cls =
    tier === "Banxer"  ? styles.tierBanxer  :
    tier === "Diamond" ? styles.tierDiamond :
    tier === "Gold"    ? styles.tierGold    :
    tier === "Silver"  ? styles.tierSilver  :
    tier === "Bronze"  ? styles.tierBronze  :
    styles.tierNone;
  return <span className={`${styles.tierBadge} ${cls}`}>{tier}</span>;
}

function PositionCard({ position }: { position: StakingPosition }) {
  const explorerBase = "https://explorer.alephium.org/addresses";

  const effectiveWithdrawable =
    parseFloat(position.withdrawableAbx) > 0
      ? position.withdrawableAbx
      : position.withdrawableAfterUnlockAbx;

  const tier = getStakingTier(position.stakedAbx);

  return (
    <div className={styles.positionCard}>
      {/* Header */}
      <div className={styles.positionHeader}>
        <a href={`${explorerBase}/${position.stakerContract}`}
          target="_blank" rel="noopener noreferrer"
          className={styles.contractLink} title={position.stakerContract}>
          Staker: {truncateAddress(position.stakerContract)}
        </a>
        <div className={styles.positionBadges}>
          <TierBadge tier={tier} />
          <StatusBadge status={position.status} />
        </div>
      </div>

      {/* ABX stats */}
      <div className={styles.statsGrid}>
        <div className={styles.statBox}>
          <span className={styles.statBoxLabel}>STAKED ABX</span>
          <span className={styles.statBoxValue}>{fmt(position.stakedAbx)}</span>
        </div>
        <div className={styles.statBox}>
          <span className={styles.statBoxLabel}>LOCKED (VESTING)</span>
          <span className={styles.statBoxValue}>{fmt(position.lockedAbx)}</span>
          {position.nextUnlockAt && (
            <span className={styles.statBoxSub}>
              Unlocks {new Date(position.nextUnlockAt).toLocaleDateString()}
            </span>
          )}
        </div>
        <div className={styles.statBox}>
          <span className={styles.statBoxLabel}>WITHDRAWABLE</span>
          <span className={styles.statBoxValue}>{fmt(effectiveWithdrawable)}</span>
          {parseFloat(position.withdrawableAbx) === 0 &&
            parseFloat(position.withdrawableAfterUnlockAbx) > 0 && (
              <span className={styles.statBoxSub}>claim to withdraw to wallet</span>
            )}
        </div>
      </div>

      {/* Vesting lock detail */}
      {position.lockCount > 0 && (
        <div className={styles.locksSection}>
          <div className={styles.locksTitle}>VESTING LOCK</div>
          <div className={styles.lockRow}>
            <span className={styles.lockAmount}>{fmt(position.lockedAbx)} ABX</span>
            {position.nextUnlockAt ? (
              new Date(position.nextUnlockAt).getTime() > Date.now() ? (
                <span className={styles.lockDateFuture}>
                  Unlocks {new Date(position.nextUnlockAt).toLocaleString()}
                </span>
              ) : (
                <span className={styles.lockDateReady}>
                  Ready to unlock (since {new Date(position.nextUnlockAt).toLocaleDateString()})
                </span>
              )
            ) : (
              <span className={styles.lockDateReady}>Ready to withdraw</span>
            )}
          </div>
        </div>
      )}

      {/* ALPH rewards (from watcher cache) */}
      <div className={styles.revenueSection}>
        <div className={styles.revenueSectionTitle}>ALPH REWARDS</div>
        <div className={styles.revenueGrid}>
          <div className={styles.revenueBox}>
            <span className={styles.revenueLabel}>Claimable ALPH</span>
            <span className={styles.revenueValue}>{fmt(position.claimableAlph)} ALPH</span>
          </div>
          <div className={styles.revenueBox}>
            <span className={styles.revenueLabel}>Lifetime Earned</span>
            <span className={styles.revenueValue}>{fmt(position.totalEarnedAlph)} ALPH</span>
          </div>
          <div className={styles.revenueBox}>
            <span className={styles.revenueLabel}>Yield per ABX</span>
            <span className={styles.revenueValue}>
              {parseFloat(position.stakedAbx) > 0
                ? `${formatNumber(
                    (parseFloat(position.totalEarnedAlph) || 0) / (parseFloat(position.stakedAbx) || 1),
                    { maximumFractionDigits: 6 },
                  )} ALPH / ABX`
                : "—"}
            </span>
          </div>
        </div>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────

interface Props { walletAddress: string }

export function MyStakingPanel({ walletAddress }: Props) {
  const { signer } = useWallet();
  const [positions, setPositions] = useState<StakingPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStakeModal, setShowStakeModal] = useState(false);
  const [showUnstakeModal, setShowUnstakeModal] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingTx, setPendingTx] = useState<PendingTx | null>(null);

  const position = positions[0] ?? null;

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollAttemptsRef = useRef(0);

  function loadPositions() {
    if (!walletAddress) return;
    setLoading(true);
    setError(null);
    fetchStakerByOwner(walletAddress)
      .then((data) => setPositions(data.positions))
      .catch((err) => setError(err.message ?? "Failed to load staking positions"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadPositions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  // Transaction polling
  useEffect(() => {
    if (!pendingTx || pendingTx.phase !== "mempool") return;

    pollAttemptsRef.current = 0;
    pollIntervalRef.current = setInterval(async () => {
      pollAttemptsRef.current += 1;
      try {
        const statusType = await pollTxStatus(pendingTx.txId);
        if (statusType === "Confirmed") {
          clearInterval(pollIntervalRef.current!);
          setPendingTx({ ...pendingTx, phase: "confirmed" });
          setTimeout(async () => {
            try {
              // Ask API to fetch fresh data from chain and write it to DDB,
              // then use the returned position to update the UI immediately.
              const freshPosition = await reindexStakerPosition(walletAddress);
              if (freshPosition) {
                setPositions([freshPosition]);
              } else {
                loadPositions(); // fallback: read from cache (e.g. full unstake)
              }
            } catch {
              loadPositions(); // fallback on any error
            }
            setTimeout(() => setPendingTx(null), 4000);
          }, 1000);
        } else if (statusType === "Conflicted") {
          clearInterval(pollIntervalRef.current!);
          setPendingTx({ ...pendingTx, phase: "failed" });
        } else if (pollAttemptsRef.current >= POLL_MAX_ATTEMPTS) {
          clearInterval(pollIntervalRef.current!);
          setPendingTx({ ...pendingTx, phase: "failed" });
        }
      } catch {
        if (pollAttemptsRef.current >= POLL_MAX_ATTEMPTS) {
          clearInterval(pollIntervalRef.current!);
          setPendingTx({ ...pendingTx, phase: "failed" });
        }
      }
    }, POLL_INTERVAL_MS);

    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTx?.txId, pendingTx?.phase]);

  function handleTxSubmitted(txId: string) {
    setShowStakeModal(false);
    setShowUnstakeModal(false);
    setActionLoading(null);
    setActionError(null);
    setPendingTx({ txId, phase: "mempool" });
  }

  async function handleClaimAlph() {
    if (!signer || !position || !canClaimAlph(position)) return;
    setActionLoading("claim-alph");
    setActionError(null);
    try {
      const txId = await claimStakerAlph(
        signer,
        walletAddress,
        parseFloat(position.claimableAlph) || 0,
      );
      handleTxSubmitted(txId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Claim ALPH failed";
      setActionError(msg.length > 140 ? msg.slice(0, 140) + "…" : msg);
      setActionLoading(null);
    }
  }

  async function handleClaimVesting() {
    if (!signer || !position || !canClaimVesting(position)) return;
    setActionLoading("claim-vesting");
    setActionError(null);
    try {
      const txId = await claimVestingAbx(
        signer,
        walletAddress,
        position.stakerContract,
      );
      handleTxSubmitted(txId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Claim vesting failed";
      setActionError(msg.length > 140 ? msg.slice(0, 140) + "…" : msg);
      setActionLoading(null);
    }
  }

  const actionsDisabled = !!pendingTx || !!actionLoading;

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Your Position</span>
      </div>

      {pendingTx && <TxProgressBanner tx={pendingTx} />}

      {loading ? (
        <div className={styles.loading}>Loading your staking positions…</div>
      ) : error ? (
        <div className={styles.error}>{error}</div>
      ) : positions.length === 0 ? (
        <div className={styles.empty}>
          No staking position found for your wallet. Positions are indexed every 5 minutes.
        </div>
      ) : (
        <div className={styles.positionList}>
          {positions.map((p) => (
            <PositionCard key={p.stakerContract} position={p} />
          ))}
        </div>
      )}

      {signer && (
        <>
          {actionError && <div className={styles.actionError}>{actionError}</div>}
          <div className={`${styles.actionBar} ${!position ? styles.actionBarBottom : ""}`}>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.actionBtnGreen}`}
              onClick={() => setShowStakeModal(true)}
              disabled={actionsDisabled}
            >
              + Stake ABX
            </button>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.actionBtnYellow}`}
              onClick={() => setShowUnstakeModal(true)}
              disabled={actionsDisabled || !position || !canUnstake(position)}
            >
              {actionLoading === "unstake" ? "Signing…" : "Unstake"}
            </button>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.actionBtnGreen}`}
              onClick={handleClaimAlph}
              disabled={actionsDisabled || !position || !canClaimAlph(position)}
            >
              {actionLoading === "claim-alph" ? "Signing…" : "Claim ALPH"}
            </button>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.actionBtnYellow}`}
              onClick={handleClaimVesting}
              disabled={actionsDisabled || !position || !canClaimVesting(position)}
            >
              {actionLoading === "claim-vesting" ? "Signing…" : "Claim Vesting"}
            </button>
          </div>
          {position && (
            <div className={styles.footer}>
              <span className={styles.lastUpdated}>
                Last updated: {new Date(position.lastUpdated).toLocaleString()}
              </span>
            </div>
          )}
        </>
      )}

      {showStakeModal && (
        <StakeModal onClose={() => setShowStakeModal(false)} onTxSubmitted={handleTxSubmitted} />
      )}
      {showUnstakeModal && position && (
        <UnstakeModal
          stakedAbx={position.stakedAbx}
          onClose={() => setShowUnstakeModal(false)}
          onTxSubmitted={handleTxSubmitted}
        />
      )}
    </div>
  );
}
