"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@alephium/web3-react";
import { sendEvent } from "@socialgouv/matomo-next";
import { fetchLoanByOwner, fetchLoans, fetchOraclePrice, indexLoan, type Loan } from "@/lib/api";
import { formatTokenAmount, toUsd } from "@/lib/format";
import {
  LIQUIDATION_LTV_PERCENT,
  formatPercent,
  formatUsdPrice,
  getLtvRiskTier,
  displayInterestRate,
  loanLiquidationPrice,
  loanLtvPercent,
  ltvBarWidth,
  parseAmount,
} from "@/lib/loan-metrics";
import { StatsBar } from "./StatsBar";
import { MyLoanPanel } from "./MyLoanPanel";
import { TokenIcon } from "./TokenIcon";
import styles from "./LoanList.module.css";

const PAGE_SIZE = 25;

type SortKey =
  | "owner"
  | "collateral"
  | "debt"
  | "ltv"
  | "liquidationPrice"
  | "interestRate"
  | "lastUpdated";

type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "owner", label: "Borrower" },
  { key: "collateral", label: "Collateral" },
  { key: "debt", label: "Debt" },
  { key: "ltv", label: "LTV" },
  { key: "liquidationPrice", label: "Liq. Price" },
  { key: "interestRate", label: "Interest" },
  { key: "lastUpdated", label: "Updated" },
];

const NUMERIC_COLUMNS = new Set<SortKey>([
  "collateral",
  "debt",
  "ltv",
  "liquidationPrice",
  "interestRate",
]);

function truncate(addr: string, start = 6, end = 4): string {
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

function parseNum(value: string): number {
  return parseFloat(value) || 0;
}

function parseRate(value: string): number {
  const normalized = value.replace("%", "").trim();
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

function ltvForLoan(
  loan: Loan,
  abdPrice: string | null,
  alphPrice: string | null,
): number | null {
  return loanLtvPercent(loan.debt, loan.collateral, abdPrice, alphPrice);
}

function liquidationPriceForLoan(
  loan: Loan,
  abdPrice: string | null,
): number | null {
  return loanLiquidationPrice(loan.debt, loan.collateral, abdPrice);
}

function hasActiveDebt(loan: Loan): boolean {
  return parseNum(loan.debt) > 0;
}

function compareLoans(
  a: Loan,
  b: Loan,
  key: SortKey,
  dir: SortDir,
  abdPrice: string | null,
  alphPrice: string | null,
): number {
  const aActive = hasActiveDebt(a);
  const bActive = hasActiveDebt(b);
  if (aActive !== bActive) {
    return aActive ? -1 : 1;
  }

  let cmp = 0;

  switch (key) {
    case "owner":
      cmp = a.owner.localeCompare(b.owner);
      break;
    case "collateral":
      cmp = parseNum(a.collateral) - parseNum(b.collateral);
      break;
    case "debt":
      cmp = parseNum(a.debt) - parseNum(b.debt);
      break;
    case "ltv": {
      const aLtv = ltvForLoan(a, abdPrice, alphPrice);
      const bLtv = ltvForLoan(b, abdPrice, alphPrice);
      cmp = (aLtv ?? -1) - (bLtv ?? -1);
      break;
    }
    case "liquidationPrice": {
      const aLiq = liquidationPriceForLoan(a, abdPrice);
      const bLiq = liquidationPriceForLoan(b, abdPrice);
      cmp = (aLiq ?? -1) - (bLiq ?? -1);
      break;
    }
    case "interestRate":
      cmp = parseRate(a.interestRate) - parseRate(b.interestRate);
      break;
    case "lastUpdated":
      cmp = new Date(a.lastUpdated).getTime() - new Date(b.lastUpdated).getTime();
      break;
  }

  return dir === "asc" ? cmp : -cmp;
}

export function LoanList() {
  const wallet = useWallet();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [abdPrice, setAbdPrice] = useState<string | null>(null);
  const [alphPrice, setAlphPrice] = useState<string | null>(null);
  const [priceLoading, setPriceLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("debt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [myLoan, setMyLoan] = useState<Loan | null>(null);
  const [myLoanLoading, setMyLoanLoading] = useState(false);

  useEffect(() => {
    fetchLoans()
      .then((data) => setLoans(data.loans))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));

    fetchOraclePrice()
      .then((data) => {
        setAbdPrice(data.abdUsd);
        setAlphPrice(data.alphUsd);
      })
      .catch(() => {
        setAbdPrice(null);
        setAlphPrice(null);
      })
      .finally(() => setPriceLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return loans;
    return loans.filter(
      (l) =>
        l.owner.toLowerCase().includes(q) ||
        l.loanAddress.toLowerCase().includes(q),
    );
  }, [loans, search]);

  const [myLoanTick, setMyLoanTick] = useState(0);
  const refetchMyLoan = useCallback(() => setMyLoanTick((t) => t + 1), []);

  useEffect(() => {
    if (wallet.connectionStatus !== "connected" || !wallet.account) {
      setMyLoan(null);
      return;
    }
    const address = wallet.account.address;
    setMyLoanLoading(true);
    fetchLoanByOwner(address)
      .then(async (loan) => {
        setMyLoan(loan);
        if (!loan) return;
        // Ensure the loan is persisted in DynamoDB (fire-and-forget)
        indexLoan(loan.owner).catch(() => {});
        // Inject into the list state if not already present so other
        // users see it on their next load and the count stays accurate
        setLoans((prev) =>
          prev.some((l) => l.loanAddress === loan.loanAddress)
            ? prev
            : [...prev, loan],
        );
      })
      .catch(() => setMyLoan(null))
      .finally(() => setMyLoanLoading(false));
  }, [wallet.connectionStatus, wallet.account, myLoanTick]);

  // Keep myLoan in the table — highlight the row instead of hiding it.
  const tableLoans = useMemo(() => filtered, [filtered]);

  const sorted = useMemo(() => {
    return [...tableLoans].sort((a, b) =>
      compareLoans(a, b, sortKey, sortDir, abdPrice, alphPrice),
    );
  }, [tableLoans, sortKey, sortDir, abdPrice, alphPrice]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "owner" || key === "lastUpdated" ? "asc" : "desc");
    }
  }

  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  const walletConnected =
    wallet.connectionStatus === "connected" && !!wallet.account;

  return (
    <>
      <StatsBar
        loans={loans}
        loading={loading}
        abdPrice={abdPrice}
        alphPrice={alphPrice}
        priceLoading={priceLoading}
      />

      <section id="loans" className={styles.section}>
        {/* Wallet loan panel — shown above the list title */}
        {walletConnected && myLoanLoading && (
          <div className={styles.emptyBox}>Searching for your loan…</div>
        )}

        {walletConnected && !myLoanLoading && myLoan && wallet.account && wallet.signer && (
          <MyLoanPanel
            loan={myLoan}
            abdPrice={abdPrice}
            alphPrice={alphPrice}
            walletAddress={wallet.account.address}
            signer={wallet.signer}
            onLoanRefetch={refetchMyLoan}
          />
        )}

        {walletConnected && !myLoanLoading && !myLoan && (
          <div className={styles.noLoanBox}>
            <p className={styles.noLoanText}>You don&apos;t have a loan yet.</p>
            <a
              href="https://app.alphbanx.com"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.createLoanBtn}
              onClick={() =>
                sendEvent({ category: "loan", action: "create_loan_cta" })
              }
            >
              Create new loan ↗
            </a>
          </div>
        )}

        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Loan List</h2>
            <p className={styles.sectionSub}>Explore active loans on the protocol.</p>
          </div>
          <div className={styles.controls}>
            <div className={styles.searchBox}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M9.5 9.5L12 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                placeholder="Search by address…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={styles.searchInput}
              />
            </div>
            {!loading && !error && (
              <span className={styles.count}>
                {tableLoans.length} loan{tableLoans.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        {loading && <div className={styles.emptyBox}>Loading loans…</div>}

        {error && (
          <div className={styles.errorBox}>
            <strong>Failed to load loans.</strong> <span>{error}</span>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && !myLoan && (
          <div className={styles.emptyBox}>No open loans found at this time.</div>
        )}

        {!loading && !error && (tableLoans.length > 0 || myLoan) && tableLoans.length > 0 && (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        className={NUMERIC_COLUMNS.has(col.key) ? styles.numCell : undefined}
                      >
                        <button
                          type="button"
                          className={styles.sortBtn}
                          onClick={() => handleSort(col.key)}
                        >
                          {col.label}
                          <span className={styles.sortIcon}>{sortIndicator(col.key)}</span>
                        </button>
                      </th>
                    ))}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((loan) => {
                    const ltv = ltvForLoan(loan, abdPrice, alphPrice);
                    const riskTier = ltv !== null ? getLtvRiskTier(ltv) : null;
                    const liqPrice = liquidationPriceForLoan(loan, abdPrice);
                    const alphUsd = alphPrice ? parseAmount(alphPrice) : null;
                    const belowLiq =
                      liqPrice !== null && alphUsd !== null && alphUsd < liqPrice;
                    const explorerUrl = `https://explorer.alephium.org/addresses/${loan.loanAddress}`;
                    const isMyLoan = myLoan?.loanAddress === loan.loanAddress;

                    return (
                      <tr key={loan.loanAddress} className={isMyLoan ? styles.myLoanRow : undefined}>
                        <td>
                          <a
                            href={`https://explorer.alephium.org/addresses/${loan.owner}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.addressLink}
                            title={loan.owner}
                          >
                            {truncate(loan.owner)}
                            <span className={styles.externalIcon}>↗</span>
                          </a>
                        </td>
                        <td className={styles.numCell}>
                          <div className={styles.amountCell}>
                            <span className={styles.amountRow}>
                              <span className={styles.amount}>{formatTokenAmount(loan.collateral)}</span>
                              <TokenIcon symbol="ALPH" size={14} showSymbol />
                            </span>
                            {toUsd(loan.collateral, alphPrice) && (
                              <span className={styles.usdValue}>
                                {toUsd(loan.collateral, alphPrice)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={styles.numCell}>
                          <div className={styles.amountCell}>
                            <span className={styles.amountRow}>
                              <span className={styles.amount}>{formatTokenAmount(loan.debt)}</span>
                              <TokenIcon symbol="ABD" size={14} showSymbol />
                            </span>
                            {toUsd(loan.debt, abdPrice) && (
                              <span className={styles.usdValue}>
                                {toUsd(loan.debt, abdPrice)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={styles.numCell}>
                          {ltv === null || !riskTier ? (
                            <span className={styles.muted}>—</span>
                          ) : (
                            <div className={styles.ltvCell}>
                              <span style={{ color: riskTier.color }}>{formatPercent(ltv)}</span>
                              <div className={styles.ltvBar}>
                                <div
                                  className={styles.ltvFill}
                                  style={{
                                    width: `${ltvBarWidth(ltv)}%`,
                                    background: riskTier.color,
                                  }}
                                />
                              </div>
                              <span className={styles.ltvTier} style={{ color: riskTier.color }}>
                                {riskTier.label}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className={styles.numCell}>
                          {liqPrice === null ? (
                            <span className={styles.muted}>—</span>
                          ) : (
                            <span
                              className={styles.liqPrice}
                              style={{
                                color: belowLiq
                                  ? "var(--status-undercollateralized)"
                                  : undefined,
                              }}
                              title={`Liquidation below ${LIQUIDATION_LTV_PERCENT}% LTV`}
                            >
                              {formatUsdPrice(liqPrice)}
                            </span>
                          )}
                        </td>
                        <td className={`${styles.muted} ${styles.numCell}`}>
                          {displayInterestRate(loan.interestRate, loan.debt)}
                        </td>
                        <td className={styles.muted}>{timeAgo(loan.lastUpdated)}</td>
                        <td>
                          <a
                            href={explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.actionBtn}
                            title="View on Explorer"
                            onClick={() =>
                              sendEvent({
                                category: "loan",
                                action: "view_on_explorer",
                                name: loan.loanAddress,
                              })
                            }
                          >
                            ⓘ
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className={styles.pagination}>
              <button
                type="button"
                className={styles.pageBtn}
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span className={styles.pageInfo}>
                Page {currentPage} of {totalPages}
                <span className={styles.pageRange}>
                  {" "}({(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, sorted.length)} of {sorted.length})
                </span>
              </span>
              <button
                type="button"
                className={styles.pageBtn}
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </>
        )}

        {!loading && !error && loans.length > 0 && (
          <div className={styles.footer}>
            <span className={styles.autoUpdate}>
              <span className={styles.updateDot} />
              Auto-updating every 5 minutes
            </span>
          </div>
        )}
      </section>
    </>
  );
}
