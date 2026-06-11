"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@alephium/web3-react";
import { fetchStakers, type StakingPosition, type StakingSummary } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { getStakingTier, type StakingTier } from "@/lib/staking-tiers";
import { MyStakingPanel } from "./MyStakingPanel";
import styles from "./StakingPage.module.css";

type StatusFilter = "all" | "active" | "vesting" | "withdrawable";
type SortKey = "stakedAbx" | "lockedAbx" | "withdrawableAbx" | "status" | "nextUnlockAt" | "claimableAlph" | "totalEarnedAlph";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 25;

function truncateAddress(addr: string, start = 6, end = 4): string {
  if (addr.length <= start + end + 3) return addr;
  return `${addr.slice(0, start)}…${addr.slice(-end)}`;
}

function formatAbx(val: string): string {
  const n = parseFloat(val) || 0;
  if (n === 0) return "—";
  return formatNumber(n, { maximumFractionDigits: 4 });
}

function StatusBadge({ status }: { status: StakingPosition["status"] }) {
  const cls =
    status === "active"
      ? styles.badgeActive
      : status === "vesting"
        ? styles.badgeVesting
        : styles.badgeWithdrawable;
  const label =
    status === "active" ? "ACTIVE" : status === "vesting" ? "VESTING" : "WITHDRAWABLE";
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

const EXPLORER = "https://explorer.alephium.org/addresses";

export function StakingPage() {
  const wallet = useWallet();
  const [stakers, setStakers] = useState<StakingPosition[]>([]);
  const [summary, setSummary] = useState<StakingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("stakedAbx");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchStakers()
      .then((data) => {
        setStakers(data.stakers);
        setSummary(data.summary);
      })
      .catch((err) => setError(err.message ?? "Failed to load staking positions"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const counts = useMemo(
    () => ({
      all: stakers.length,
      active: stakers.filter((s) => s.status === "active").length,
      vesting: stakers.filter((s) => s.status === "vesting").length,
      withdrawable: stakers.filter((s) => s.status === "withdrawable").length,
    }),
    [stakers],
  );

  const handleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("desc");
      }
    },
    [sortKey],
  );

  const filtered = useMemo(() => {
    const base =
      statusFilter === "all" ? stakers : stakers.filter((s) => s.status === statusFilter);

    return [...base].sort((a, b) => {
      let cmp = 0;
      if (
        sortKey === "stakedAbx" || sortKey === "lockedAbx" || sortKey === "withdrawableAbx" ||
        sortKey === "claimableAlph" || sortKey === "totalEarnedAlph"
      ) {
        cmp = (parseFloat(a[sortKey]) || 0) - (parseFloat(b[sortKey]) || 0);
      } else if (sortKey === "status") {
        cmp = a.status.localeCompare(b.status);
      } else if (sortKey === "nextUnlockAt") {
        const ta = a.nextUnlockAt ? new Date(a.nextUnlockAt).getTime() : 0;
        const tb = b.nextUnlockAt ? new Date(b.nextUnlockAt).getTime() : 0;
        cmp = ta - tb;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [stakers, statusFilter, sortKey, sortDir]);

  // Reset to page 1 whenever the view changes
  useEffect(() => { setPage(1); }, [statusFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  const walletConnected =
    wallet.connectionStatus === "connected" && !!wallet.account;

  const SortArrow = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <span style={{ opacity: 0.3 }}> ↕</span>;
    return <span> {sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  const FILTERS: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "vesting", label: "Vesting" },
    { key: "withdrawable", label: "Withdrawable" },
  ];

  return (
    <main className={styles.main}>
      {/* Summary bar */}
      <div className={styles.statsBar}>
        <div className={styles.statsInner}>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>TOTAL STAKERS</span>
            <span className={styles.statValue}>
              {loading
                ? "—"
                : formatNumber(summary?.totalStakers ?? stakers.length, { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>TOTAL STAKED ABX</span>
            <span className={styles.statValue}>
              {loading ? "—" : formatAbx(summary?.totalStakedAbx ?? "0")}
            </span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>TOTAL LOCKED (VESTING)</span>
            <span className={styles.statValue}>
              {loading ? "—" : formatAbx(summary?.totalLockedAbx ?? "0")}
            </span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>TOTAL WITHDRAWABLE</span>
            <span className={styles.statValue}>
              {loading ? "—" : formatAbx(summary?.totalWithdrawableAbx ?? "0")}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.content}>
        {/* Your Position */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Your Position</h2>
            <p className={styles.sectionSub}>
              View your staked ABX, vesting locks, and withdrawable amounts.
            </p>
          </div>

          {walletConnected && wallet.account ? (
            <MyStakingPanel walletAddress={wallet.account.address} />
          ) : (
            <div className={styles.connectPrompt}>
              Connect your wallet to view your staking position.
            </div>
          )}
        </section>

        {/* All Staking Positions */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>All Staking Positions</h2>
            <p className={styles.sectionSub}>
              All active ABX staking positions indexed from the StakeManager contract, updated every 5 minutes.
            </p>
          </div>

          {/* Filter tabs */}
          <div className={styles.statusTabs}>
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                className={`${styles.statusTab} ${statusFilter === key ? styles.statusTabActive : ""}`}
                onClick={() => setStatusFilter(key)}
              >
                {label}
                <span className={styles.statusTabCount}>
                  {formatNumber(counts[key], { maximumFractionDigits: 0 })}
                </span>
              </button>
            ))}
          </div>

          {loading ? (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead className={styles.tableHead}>
                  <tr>
                    <th>STAKER CONTRACT</th>
                    <th>OWNER</th>
                    <th>TIER</th>
                    <th>STAKED ABX</th>
                    <th>LOCKED (VESTING)</th>
                    <th>WITHDRAWABLE</th>
                    <th>CLAIMABLE ALPH</th>
                    <th>LIFETIME EARNED</th>
                    <th>NEXT UNLOCK</th>
                    <th>STATUS</th>
                  </tr>
                </thead>

                <tbody>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className={styles.skeletonRow}>
                      {Array.from({ length: 10 }).map((__, j) => (
                        <td key={j}>
                          <div className={styles.skeletonCell} style={{ width: j === 0 ? "120px" : j === 2 ? "80px" : "60px" }} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : error ? (
            <div className={styles.error}>
              <span>{error}</span>
              <button className={styles.retryBtn} onClick={loadData}>Retry</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className={styles.emptyState}>
              No {statusFilter === "all" ? "" : statusFilter + " "}staking positions found.
              {stakers.length === 0 && " Positions are indexed every 5 minutes."}
            </div>
          ) : (
            <>
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead className={styles.tableHead}>
                    <tr>
                      <th>STAKER CONTRACT</th>
                      <th>OWNER</th>
                      <th>TIER</th>
                      <th
                        className={`${styles.sortableHeader} ${styles.numCell}`}
                        onClick={() => handleSort("stakedAbx")}
                      >
                        STAKED ABX<SortArrow k="stakedAbx" />
                      </th>
                      <th
                        className={`${styles.sortableHeader} ${styles.numCell}`}
                        onClick={() => handleSort("lockedAbx")}
                      >
                        LOCKED (VESTING)<SortArrow k="lockedAbx" />
                      </th>
                      <th
                        className={`${styles.sortableHeader} ${styles.numCell}`}
                        onClick={() => handleSort("withdrawableAbx")}
                      >
                        WITHDRAWABLE<SortArrow k="withdrawableAbx" />
                      </th>
                      <th
                        className={`${styles.sortableHeader} ${styles.numCell}`}
                        onClick={() => handleSort("claimableAlph")}
                      >
                        CLAIMABLE ALPH<SortArrow k="claimableAlph" />
                      </th>
                      <th
                        className={`${styles.sortableHeader} ${styles.numCell}`}
                        onClick={() => handleSort("totalEarnedAlph")}
                      >
                        LIFETIME EARNED<SortArrow k="totalEarnedAlph" />
                      </th>
                      <th
                        className={styles.sortableHeader}
                        onClick={() => handleSort("nextUnlockAt")}
                      >
                        NEXT UNLOCK<SortArrow k="nextUnlockAt" />
                      </th>
                      <th
                        className={styles.sortableHeader}
                        onClick={() => handleSort("status")}
                      >
                        STATUS<SortArrow k="status" />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((s) => (
                      <tr key={s.stakerContract} className={styles.tableRow}>
                        <td>
                          <a
                            href={`${EXPLORER}/${s.stakerContract}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.addrLink}
                            title={s.stakerContract}
                          >
                            {truncateAddress(s.stakerContract)}
                          </a>
                        </td>
                        <td>
                          <a
                            href={`${EXPLORER}/${s.ownerAddress}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.ownerLink}
                            title={s.ownerAddress}
                          >
                            {truncateAddress(s.ownerAddress)}
                          </a>
                        </td>
                        <td><TierBadge tier={getStakingTier(s.stakedAbx)} /></td>
                        <td className={styles.amountCell}>{formatAbx(s.stakedAbx)} ABX</td>
                        <td className={parseFloat(s.lockedAbx) > 0 ? styles.amountCell : styles.dimCell}>
                          {formatAbx(s.lockedAbx)} {parseFloat(s.lockedAbx) > 0 ? "ABX" : ""}
                        </td>
                        {(() => {
                          // Use withdrawableAfterUnlockAbx when tokens are ready but unlock tx hasn't been called yet
                          const effective =
                            parseFloat(s.withdrawableAbx) > 0
                              ? s.withdrawableAbx
                              : s.status === "withdrawable"
                                ? s.withdrawableAfterUnlockAbx
                                : "0";
                          const needsUnlock =
                            parseFloat(s.withdrawableAbx) === 0 &&
                            s.status === "withdrawable" &&
                            parseFloat(effective) > 0;
                          return (
                            <td
                              className={parseFloat(effective) > 0 ? styles.amountCell : styles.dimCell}
                              title={needsUnlock ? "Requires unlock transaction first" : undefined}
                            >
                              {formatAbx(effective)} {parseFloat(effective) > 0 ? "ABX" : ""}
                              {needsUnlock && <span className={styles.unlockHint}> *</span>}
                            </td>
                          );
                        })()}
                        <td className={parseFloat(s.claimableAlph) > 0 ? styles.alphCell : styles.dimCell}>
                          {parseFloat(s.claimableAlph) > 0
                            ? `${formatNumber(s.claimableAlph, { maximumFractionDigits: 4 })} ALPH`
                            : "—"}
                        </td>
                        <td className={parseFloat(s.totalEarnedAlph) > 0 ? styles.alphCell : styles.dimCell}>
                          {parseFloat(s.totalEarnedAlph) > 0
                            ? `${formatNumber(s.totalEarnedAlph, { maximumFractionDigits: 4 })} ALPH`
                            : "—"}
                        </td>
                        <td className={styles.dateCell}>
                          {s.nextUnlockAt
                            ? new Date(s.nextUnlockAt).toLocaleDateString()
                            : "—"}
                        </td>
                        <td>
                          <StatusBadge status={s.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Footnote for unlock hint */}
              {paginated.some(
                (s) => s.status === "withdrawable" && parseFloat(s.withdrawableAbx) === 0,
              ) && (
                <p className={styles.footnote}>
                  * Amount shown is available after calling the unlock transaction on-chain.
                </p>
              )}

              {/* Pagination controls */}
              <div className={styles.pagination}>
                <span className={styles.paginationInfo}>
                  Showing{" "}
                  {formatNumber(Math.min((page - 1) * PAGE_SIZE + 1, filtered.length), {
                    maximumFractionDigits: 0,
                  })}
                  –
                  {formatNumber(Math.min(page * PAGE_SIZE, filtered.length), {
                    maximumFractionDigits: 0,
                  })}{" "}
                  of {formatNumber(filtered.length, { maximumFractionDigits: 0 })}
                </span>
                <div className={styles.paginationControls}>
                  <button
                    className={styles.pageBtn}
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                  >
                    «
                  </button>
                  <button
                    className={styles.pageBtn}
                    onClick={() => setPage((p) => p - 1)}
                    disabled={page === 1}
                  >
                    ‹ Prev
                  </button>
                  <span className={styles.pageIndicator}>
                    Page {page} of {totalPages}
                  </span>
                  <button
                    className={styles.pageBtn}
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page === totalPages}
                  >
                    Next ›
                  </button>
                  <button
                    className={styles.pageBtn}
                    onClick={() => setPage(totalPages)}
                    disabled={page === totalPages}
                  >
                    »
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
