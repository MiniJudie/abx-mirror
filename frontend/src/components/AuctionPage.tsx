"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@alephium/web3-react";
import {
  fetchAuctionBidders,
  fetchAuctions,
  fetchLiquidations,
  type AuctionPool,
  type BidderStat,
  type BidderSummary,
  type LiquidationEvent,
} from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { AuctionPoolCard } from "./AuctionPoolCard";
import { LiquidationHistory } from "./LiquidationHistory";
import { MyAuctionPanel } from "./MyAuctionPanel";
import styles from "./AuctionPage.module.css";

function truncateAddress(addr: string, start = 6, end = 4): string {
  if (addr.length <= start + end + 3) return addr;
  return `${addr.slice(0, start)}…${addr.slice(-end)}`;
}

function sumAbdAcrossPools(pools: AuctionPool[]): string {
  const total = pools.reduce((acc, p) => {
    const n = parseFloat(p.totalAbdAmount) || 0;
    return acc + n;
  }, 0);
  return formatNumber(total, { maximumFractionDigits: 2 });
}

const EMPTY_SUMMARY: BidderSummary = { openCount: 0, filledCount: 0, canceledCount: 0 };

type BidStatusFilter = "open" | "filled" | "canceled";

export function AuctionPage() {
  const wallet = useWallet();
  const [pools, setPools] = useState<AuctionPool[]>([]);
  const [bidderSummary, setBidderSummary] = useState<BidderSummary>(EMPTY_SUMMARY);
  const [bidStatusFilter, setBidStatusFilter] = useState<BidStatusFilter>("open");
  // Cache per-tab bidder lists so we don't refetch when switching back
  const [loadedBidders, setLoadedBidders] = useState<Partial<Record<BidStatusFilter, BidderStat[]>>>({});
  const [loadingBidders, setLoadingBidders] = useState(false);
  const [liquidations, setLiquidations] = useState<LiquidationEvent[]>([]);
  const [loadingPools, setLoadingPools] = useState(true);
  const [loadingLiquidations, setLoadingLiquidations] = useState(true);
  const [poolsError, setPoolsError] = useState<string | null>(null);
  const [liquidationsError, setLiquidationsError] = useState<string | null>(null);

  const loadBiddersForStatus = useCallback((status: BidStatusFilter) => {
    setLoadingBidders(true);
    fetchAuctionBidders(status)
      .then((bidders) => setLoadedBidders((prev) => ({ ...prev, [status]: bidders })))
      .catch(() => setLoadedBidders((prev) => ({ ...prev, [status]: [] })))
      .finally(() => setLoadingBidders(false));
  }, []);

  const handleFilterChange = useCallback((status: BidStatusFilter) => {
    setBidStatusFilter(status);
    // Only fetch if not already cached
    if (loadedBidders[status] === undefined) {
      loadBiddersForStatus(status);
    }
  }, [loadedBidders, loadBiddersForStatus]);

  const loadData = useCallback(() => {
    setLoadingPools(true);
    setLoadingLiquidations(true);
    setPoolsError(null);
    setLiquidationsError(null);
    // Clear bidder cache on full reload
    setLoadedBidders({});

    fetchAuctions()
      .then((data) => {
        setPools(data.pools);
        setBidderSummary(data.bidderSummary ?? EMPTY_SUMMARY);
        // Auto-load the default "open" tab
        loadBiddersForStatus("open");
      })
      .catch((err) => setPoolsError(err.message ?? "Failed to load auction pools"))
      .finally(() => setLoadingPools(false));

    fetchLiquidations()
      .then((data) => setLiquidations(data.liquidations))
      .catch((err) => setLiquidationsError(err.message ?? "Failed to load liquidations"))
      .finally(() => setLoadingLiquidations(false));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const totalAbd = useMemo(() => sumAbdAcrossPools(pools), [pools]);
  const totalBids = useMemo(() => pools.reduce((acc, p) => acc + p.bidCount, 0), [pools]);

  const walletConnected =
    wallet.connectionStatus === "connected" && !!wallet.account;

  return (
    <main className={styles.main}>
      {/* Summary bar */}
      <div className={styles.statsBar}>
        <div className={styles.statsInner}>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>TOTAL ABD IN POOLS</span>
            <span className={styles.statValue}>{loadingPools ? "—" : totalAbd}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>ACTIVE BIDS</span>
            <span className={styles.statValue}>
              {loadingPools ? "—" : formatNumber(totalBids, { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>UNIQUE BIDDERS</span>
            <span className={styles.statValue}>
              {loadingPools ? "—" : formatNumber(bidderSummary.openCount, { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>LIQUIDATIONS</span>
            <span className={styles.statValue}>
              {loadingLiquidations ? "—" : formatNumber(liquidations.length, { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.content}>
        {/* Auction Pools */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Auction Pools</h2>
            <p className={styles.sectionSub}>
              ABD deposited as bids in each pool tier, ready to purchase collateral from liquidated loans.
            </p>
          </div>

          {loadingPools ? (
            <div className={styles.poolsGrid}>
              {[5, 10, 15, 20].map((d) => (
                <div key={d} className={styles.skeletonCard}>
                  <div className={styles.skeletonBadge} />
                  <div className={styles.skeletonLines}>
                    <div className={styles.skeletonLine} />
                    <div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
                  </div>
                </div>
              ))}
            </div>
          ) : poolsError ? (
            <div className={styles.error}>
              <span>{poolsError}</span>
              <button className={styles.retryBtn} onClick={loadData}>Retry</button>
            </div>
          ) : (
            <div className={styles.poolsGrid}>
              {pools.map((pool) => (
                <AuctionPoolCard key={pool.discount} pool={pool} />
              ))}
            </div>
          )}
        </section>

        {/* Your Positions */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Your Positions</h2>
            <p className={styles.sectionSub}>
              View and manage your auction bids. Connect your wallet to place or cancel bids.
            </p>
          </div>

          {walletConnected && wallet.account && wallet.signer ? (
            <MyAuctionPanel
              walletAddress={wallet.account.address}
              signer={wallet.signer}
              onPositionsRefetch={loadData}
            />
          ) : (
            <div className={styles.connectPrompt}>
              Connect your wallet to view your auction positions and place bids.
            </div>
          )}
        </section>

        {/* Bidders */}
        {!loadingPools && !poolsError && (
          bidderSummary.openCount > 0 ||
          bidderSummary.filledCount > 0 ||
          bidderSummary.canceledCount > 0
        ) && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Bidders</h2>
              <p className={styles.sectionSub}>
                {(() => {
                  const countKey = bidStatusFilter === "open" ? "openCount" : bidStatusFilter === "filled" ? "filledCount" : "canceledCount";
                  const n = bidderSummary[countKey];
                  const label = bidStatusFilter === "open" ? "open bids" : bidStatusFilter === "filled" ? "filled bids" : "canceled bids";
                  return `${n} bid${n !== 1 ? "s" : ""} with ${label} across all pools.`;
                })()}
              </p>
            </div>

            {/* Status filter tabs */}
            <div className={styles.statusTabs}>
              {(["open", "filled", "canceled"] as BidStatusFilter[]).map((s) => {
                const countKey = s === "open" ? "openCount" : s === "filled" ? "filledCount" : "canceledCount";
                return (
                  <button
                    key={s}
                    className={`${styles.statusTab} ${bidStatusFilter === s ? styles.statusTabActive : ""}`}
                    onClick={() => handleFilterChange(s)}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                    <span className={styles.statusTabCount}>
                      {formatNumber(bidderSummary[countKey], { maximumFractionDigits: 0 })}
                    </span>
                  </button>
                );
              })}
            </div>

            {loadingBidders ? (
              <div className={styles.biddersLoading}>Loading bidders…</div>
            ) : (loadedBidders[bidStatusFilter] ?? []).length === 0 ? (
              <div className={styles.biddersEmpty}>No {bidStatusFilter} bids found.</div>
            ) : (
              <div className={styles.biddersList}>
                {(loadedBidders[bidStatusFilter] ?? []).map((stat: BidderStat) => (
                  <div key={stat.wallet} className={styles.bidderRow}>
                    <a
                      href={`https://explorer.alephium.org/addresses/${stat.wallet}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.bidderAddr}
                      title={stat.wallet}
                    >
                      {truncateAddress(stat.wallet, 8, 6)}
                    </a>
                    <span className={styles.bidderAbd}>
                      {formatNumber(stat.abdTotal, { maximumFractionDigits: 2 })} ABD
                    </span>
                    <div className={styles.bidderBar}>
                      <div
                        className={styles.bidderBarFill}
                        style={{ width: `${stat.percent}%` }}
                      />
                    </div>
                    <span className={styles.bidderPercent}>
                      {formatNumber(stat.percent, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Liquidation History */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Liquidation History</h2>
            <p className={styles.sectionSub}>
              On-chain liquidation events recorded from the AuctionManager contract, updated every 5 minutes.
            </p>
          </div>

          {loadingLiquidations ? (
            <div className={styles.loadingText}>Loading liquidation history…</div>
          ) : liquidationsError ? (
            <div className={styles.error}>
              <span>{liquidationsError}</span>
              <button className={styles.retryBtn} onClick={loadData}>Retry</button>
            </div>
          ) : (
            <LiquidationHistory liquidations={liquidations} />
          )}
        </section>
      </div>
    </main>
  );
}
