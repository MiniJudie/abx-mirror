"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TokenIcon } from "./TokenIcon";
import { RedeemAbdPanel } from "./RedeemAbdPanel";
import {
  TokenDistributionChart,
  buildAbxSlices,
  buildAbdSlices,
} from "./TokenDistributionChart";
import { fetchTokenStats, type TokenStatsResponse } from "@/lib/api";
import styles from "./AbxAbdPage.module.css";

const EXPLORER = "https://explorer.alephium.org/tokens";

export function AbxAbdPage() {
  const [stats, setStats] = useState<TokenStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTokenStats()
      .then((s) => {
        setStats(s);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load token stats");
        setLoading(false);
      });
  }, []);

  const abxSlices = stats ? buildAbxSlices(stats) : [];
  const abdSlices = stats ? buildAbdSlices(stats) : [];

  return (
    <main className={styles.main}>
      <div className={styles.content}>

        {/* ── Page header ────────────────────────────────── */}
        <div className={styles.pageHeader}>
          <h1 className={styles.sectionTitle}>ABX / ABD</h1>
          <p className={styles.sectionSub}>
            The two core tokens of the AlphBanX lending protocol on Alephium.
          </p>
        </div>

        {/* ── Redeem ABD ─────────────────────────────────── */}
        <RedeemAbdPanel />

        {/* ── Token columns ──────────────────────────────── */}
        <div className={styles.tokensGrid}>

          {/* ABX column */}
          <div className={styles.tokenCol}>
            <div className={styles.tokenColHeader}>
              <TokenIcon symbol="ABX" size={24} showSymbol />
              <h2 className={styles.tokenColTitle}>ABX</h2>
            </div>

            {loading && <div className={styles.colLoading}><span className={styles.loadingDot} /> Loading…</div>}
            {error && !loading && <div className={styles.colError}>Failed to load distribution data</div>}
            {!loading && !error && (
              <TokenDistributionChart token="ABX" slices={abxSlices} unit="ABX" />
            )}

            <div className={styles.tokenDesc}>
              <p className={styles.descBody}>
                Protocol token used for staking. Staked ABX earns ALPH from borrowing fees
                and participates in protocol revenue sharing.
              </p>
              <div className={styles.descLinks}>
                <Link href="/staking" className={styles.descLink}>
                  View staking →
                </Link>
                <a
                  href={`${EXPLORER}/9b3070a93fd5127d8c39561870432fdbc79f598ca8dbf2a3398fc100dfd45f00`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.descLinkMuted}
                >
                  Token on Explorer ↗
                </a>
              </div>
            </div>
          </div>

          {/* ABD column */}
          <div className={styles.tokenCol}>
            <div className={styles.tokenColHeader}>
              <TokenIcon symbol="ABD" size={24} showSymbol />
              <h2 className={styles.tokenColTitle}>ABD</h2>
            </div>

            {loading && <div className={styles.colLoading}><span className={styles.loadingDot} /> Loading…</div>}
            {error && !loading && <div className={styles.colError}>Failed to load distribution data</div>}
            {!loading && !error && (
              <TokenDistributionChart token="ABD" slices={abdSlices} unit="ABD" />
            )}

            <div className={styles.tokenDesc}>
              <p className={styles.descBody}>
                The protocol stablecoin. Borrow ABD against ALPH collateral, deposit it in
                auction pools to bid on liquidations, or redeem it for ALPH.
              </p>
              <div className={styles.descLinks}>
                <Link href="/" className={styles.descLink}>
                  View loans →
                </Link>
                <Link href="/auction" className={styles.descLink}>
                  View auctions →
                </Link>
                <a
                  href={`${EXPLORER}/c7d1dab489ee40ca4e6554efc64a64e73a9f0ddfdec9e544c82c1c6742ccc500`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.descLinkMuted}
                >
                  Token on Explorer ↗
                </a>
              </div>
            </div>

            {stats?.updatedAt && (
              <p className={styles.updatedAt}>
                Distribution updated {new Date(stats.updatedAt).toLocaleString()}
              </p>
            )}
          </div>

        </div>
      </div>
    </main>
  );
}
