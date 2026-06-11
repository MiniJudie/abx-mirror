"use client";

import { useEffect, useState } from "react";
import { sendEvent } from "@socialgouv/matomo-next";
import type { SignerProvider } from "@alephium/web3";
import type { Loan } from "@/lib/api";
import { formatTokenAmount, toUsd } from "@/lib/format";
import {
  LIQUIDATION_LTV_PERCENT,
  displayInterestRate,
  formatPercent,
  formatRatio,
  formatUsdPrice,
  getLtvRiskTier,
  loanCollateralRatio,
  loanLiquidationPrice,
  loanLtvPercent,
  ltvBarWidth,
  parseAmount,
} from "@/lib/loan-metrics";
import { TokenIcon } from "./TokenIcon";
import { LoanActionModal, type LoanActionType } from "./LoanActionModal";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { usePendingTx } from "@/hooks/usePendingTx";
import styles from "./MyLoanPanel.module.css";

const ACTION_LABEL: Record<LoanActionType, string> = {
  addCollateral: "Add Collateral",
  withdrawCollateral: "Withdraw Collateral",
  borrow: "Borrow ABD",
  repay: "Repay ABD",
};

interface Props {
  loan: Loan;
  abdPrice: string | null;
  alphPrice: string | null;
  walletAddress: string;
  signer: SignerProvider;
  onLoanRefetch: () => void;
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

export function MyLoanPanel({
  loan,
  abdPrice,
  alphPrice,
  walletAddress,
  signer,
  onLoanRefetch,
}: Props) {
  const ltv = loanLtvPercent(loan.debt, loan.collateral, abdPrice, alphPrice);
  const health = loanCollateralRatio(loan.debt, loan.collateral, abdPrice, alphPrice);
  const riskTier = ltv !== null ? getLtvRiskTier(ltv) : null;
  const liqPrice = loanLiquidationPrice(loan.debt, loan.collateral, abdPrice);
  const alphUsd = alphPrice ? parseAmount(alphPrice) : null;
  const belowLiq = liqPrice !== null && alphUsd !== null && alphUsd < liqPrice;
  const explorerUrl = `https://explorer.alephium.org/addresses/${loan.loanAddress}`;

  const [activeModal, setActiveModal] = useState<LoanActionType | null>(null);
  const [pendingOp, setPendingOp] = useState<{ txId: string; label: string } | null>(null);
  const { alphBalance, abdBalance, refresh: refreshBalances } = useWalletBalances(walletAddress);

  const { status: pendingStatus } = usePendingTx(
    pendingOp?.txId ?? null,
    () => {
      refreshBalances();
      onLoanRefetch();
    },
  );

  // Auto-dismiss confirmed banner after a short delay
  useEffect(() => {
    if (pendingStatus === "confirmed") {
      const t = setTimeout(() => setPendingOp(null), 3000);
      return () => clearTimeout(t);
    }
  }, [pendingStatus]);

  function handleSuccess(txId: string) {
    const label = activeModal ? ACTION_LABEL[activeModal] : "Operation";
    setPendingOp({ txId, label });
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Connected wallet</span>
          <h3 className={styles.title}>Your Loan</h3>
        </div>
        {riskTier && (
          <span className={styles.badge} style={{ color: riskTier.color, borderColor: riskTier.color }}>
            <span className={styles.dot} style={{ background: riskTier.color }} />
            {riskTier.label}
          </span>
        )}
      </div>

      <div className={styles.grid}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Collateral</span>
          <span className={styles.statValue}>
            {formatTokenAmount(loan.collateral)}
            <TokenIcon symbol="ALPH" size={14} showSymbol />
          </span>
          {toUsd(loan.collateral, alphPrice) && (
            <span className={styles.statSub}>{toUsd(loan.collateral, alphPrice)}</span>
          )}
        </div>

        <div className={styles.stat}>
          <span className={styles.statLabel}>Debt</span>
          <span className={styles.statValue}>
            {formatTokenAmount(loan.debt)}
            <TokenIcon symbol="ABD" size={14} showSymbol />
          </span>
          {toUsd(loan.debt, abdPrice) && (
            <span className={styles.statSub}>{toUsd(loan.debt, abdPrice)}</span>
          )}
        </div>

        <div className={styles.stat}>
          <span className={styles.statLabel}>LTV</span>
          {ltv !== null && riskTier ? (
            <>
              <span className={styles.statValue} style={{ color: riskTier.color }}>
                {formatPercent(ltv)}
              </span>
              <div className={styles.ltvBar}>
                <div
                  className={styles.ltvFill}
                  style={{ width: `${ltvBarWidth(ltv)}%`, background: riskTier.color }}
                />
              </div>
            </>
          ) : (
            <span className={styles.statMuted}>—</span>
          )}
        </div>

        <div className={styles.stat}>
          <span className={styles.statLabel}>Health Factor</span>
          {health !== null && riskTier ? (
            <span className={styles.statValue} style={{ color: riskTier.color }}>
              {formatRatio(health)}
            </span>
          ) : (
            <span className={styles.statMuted}>—</span>
          )}
        </div>

        <div className={styles.stat}>
          <span className={styles.statLabel}>Liq. Price</span>
          {liqPrice !== null ? (
            <span
              className={styles.statValue}
              style={{ color: belowLiq ? "var(--status-undercollateralized)" : undefined }}
              title={`Liquidation below ${LIQUIDATION_LTV_PERCENT}% LTV`}
            >
              {formatUsdPrice(liqPrice)}
            </span>
          ) : (
            <span className={styles.statMuted}>—</span>
          )}
        </div>

        <div className={styles.stat}>
          <span className={styles.statLabel}>Interest</span>
          <span className={styles.statValue}>
            {displayInterestRate(loan.interestRate, loan.debt)}
          </span>
        </div>
      </div>

      {/* Action button bar */}
      <div className={styles.actionBar}>
        <button
          type="button"
          className={`${styles.actionBtn} ${styles.actionBtnGreen}`}
          onClick={() => setActiveModal("addCollateral")}
        >
          Add Collateral
        </button>
        <button
          type="button"
          className={`${styles.actionBtn} ${styles.actionBtnYellow}`}
          onClick={() => setActiveModal("withdrawCollateral")}
        >
          Withdraw Collateral
        </button>
        <button
          type="button"
          className={`${styles.actionBtn} ${styles.actionBtnGreen}`}
          onClick={() => setActiveModal("borrow")}
        >
          Borrow
        </button>
        <button
          type="button"
          className={`${styles.actionBtn} ${styles.actionBtnYellow}`}
          onClick={() => setActiveModal("repay")}
        >
          Repay
        </button>
      </div>

      <div className={styles.footer}>
        <span className={styles.updated}>Updated {timeAgo(loan.lastUpdated)}</span>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.explorerLink}
          onClick={() =>
            sendEvent({ category: "loan", action: "view_my_loan", name: loan.loanAddress })
          }
        >
          View on Explorer ↗
        </a>
      </div>

      {/* Pending / confirmed transaction banner */}
      {pendingOp && (
        <div className={`${styles.pendingBanner} ${pendingStatus === "confirmed" ? styles.pendingBannerConfirmed : ""}`}>
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
            className={styles.pendingDismiss}
            onClick={() => setPendingOp(null)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Action modal */}
      {activeModal && (
        <LoanActionModal
          action={activeModal}
          loan={loan}
          abdPrice={abdPrice}
          alphPrice={alphPrice}
          alphBalance={alphBalance ?? 0}
          abdBalance={abdBalance ?? 0}
          walletAddress={walletAddress}
          signer={signer}
          onClose={() => setActiveModal(null)}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}
