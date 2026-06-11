"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SignerProvider } from "@alephium/web3";
import {
  createBidTx,
  ensureBidderExists,
  getMinBid,
} from "@/lib/auction-actions";
import { formatNumber } from "@/lib/format";
import styles from "./LoanActionModal.module.css";

const POOL_TIERS = [5, 10, 15, 20] as const;

interface Props {
  walletAddress: string;
  signer: SignerProvider;
  abdBalance: number | null;
  balanceLoading: boolean;
  onClose: () => void;
  onSuccess: (txId: string) => void;
}

type SubmitStatus = "idle" | "submitting" | "success" | "error";

export function CreateBidModal({
  walletAddress,
  signer,
  abdBalance,
  balanceLoading,
  onClose,
  onSuccess,
}: Props) {
  const [discount, setDiscount] = useState<number>(5);
  const [inputValue, setInputValue] = useState("");
  const [minBid, setMinBid] = useState<number | null>(null);
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getMinBid()
      .then(setMinBid)
      .catch(() => setMinBid(null));
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const amount = parseFloat(inputValue) || 0;

  const validationHint = useMemo((): string | null => {
    if (amount <= 0) return "Enter an ABD amount greater than zero.";
    if (minBid !== null && amount < minBid) {
      return `Minimum bid is ${formatNumber(minBid, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ABD.`;
    }
    if (abdBalance !== null && amount > abdBalance) {
      return `Amount exceeds your balance of ${formatNumber(abdBalance, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ABD.`;
    }
    return null;
  }, [amount, abdBalance, minBid]);

  const isInvalid = validationHint !== null;

  const handleMax = useCallback(() => {
    if (abdBalance === null || abdBalance <= 0) return;
    setInputValue(String(Math.round(abdBalance * 1e6) / 1e6));
  }, [abdBalance]);

  const handleConfirm = useCallback(async () => {
    if (isInvalid || status === "submitting") return;
    setStatus("submitting");
    setErrorMsg("");
    try {
      await ensureBidderExists(signer, walletAddress);
      const txId = await createBidTx(signer, discount, amount);
      setStatus("success");
      setTimeout(() => {
        onSuccess(txId);
        onClose();
      }, 1500);
    } catch (err: unknown) {
      setStatus("error");
      const msg =
        err instanceof Error
          ? err.message
          : "Transaction failed. Please try again.";
      setErrorMsg(msg.length > 120 ? msg.slice(0, 120) + "…" : msg);
    }
  }, [amount, discount, isInvalid, onClose, onSuccess, signer, status, walletAddress]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const balanceLabel =
    balanceLoading || abdBalance === null
      ? "Loading…"
      : `${formatNumber(abdBalance, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ABD`;

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.dialog} role="dialog" aria-modal="true">
        <div className={styles.dialogHeader}>
          <div>
            <span className={styles.dialogEyebrow}>Auction</span>
            <h2 className={styles.dialogTitle}>Place Bid</h2>
          </div>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <p className={styles.description}>
          Deposit ABD into an auction pool. When a loan is liquidated, your bid
          may purchase collateral at the pool discount.
        </p>

        <div className={styles.rateSection}>
          <span className={styles.rateLabel}>Pool Discount</span>
          <div className={styles.rateGrid}>
            {POOL_TIERS.map((tier) => (
              <button
                key={tier}
                type="button"
                className={`${styles.rateBtn} ${discount === tier ? styles.rateBtnActive : ""}`}
                onClick={() => setDiscount(tier)}
                disabled={status === "submitting" || status === "success"}
              >
                {tier}%
              </button>
            ))}
          </div>
        </div>

        <div className={styles.metricsRow}>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>ABD Balance</span>
            <span className={styles.metricValue}>{balanceLabel}</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>Min Bid</span>
            <span className={styles.metricValue}>
              {minBid !== null
                ? `${formatNumber(minBid, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ABD`
                : "—"}
            </span>
          </div>
        </div>

        <div className={styles.inputSection}>
          <div className={styles.inputLabel}>
            <span>Amount</span>
            <span className={styles.maxAvail}>
              Max:{" "}
              <button
                type="button"
                className={styles.maxLink}
                onClick={handleMax}
                disabled={abdBalance === null || abdBalance <= 0}
              >
                {abdBalance !== null
                  ? `${formatNumber(abdBalance, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ABD`
                  : "—"}
              </button>
            </span>
          </div>
          <div className={styles.inputRow}>
            <input
              ref={inputRef}
              type="number"
              className={styles.amountInput}
              placeholder="0.00"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              disabled={status === "submitting" || status === "success"}
              min={0}
              step="any"
            />
            <span className={styles.tokenTag}>ABD</span>
          </div>
        </div>

        {isInvalid && amount > 0 && validationHint && status !== "error" && (
          <p className={styles.errorMsg}>{validationHint}</p>
        )}
        {status === "error" && errorMsg && (
          <p className={styles.errorMsg}>{errorMsg}</p>
        )}
        {status === "success" && (
          <p className={styles.successMsg}>Transaction submitted!</p>
        )}

        <button
          type="button"
          className={styles.confirmBtn}
          onClick={handleConfirm}
          disabled={isInvalid || status === "submitting" || status === "success"}
        >
          {status === "submitting"
            ? "Signing…"
            : status === "success"
              ? "Done"
              : "Place Bid"}
        </button>
      </div>
    </div>
  );
}
