"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SignerProvider } from "@alephium/web3";
import type { Loan } from "@/lib/api";
import {
  GAS_RESERVE_ALPH,
  addCollateralTx,
  withdrawCollateralTx,
  borrowAbdTx,
  repayAbdTx,
  getUserZeroFeeRemainingDebt,
  getAvailableInterestRates,
  getMintingFeeAtto,
  toAttoUnits,
  fromAttoUnits,
  ABD_DECIMALS,
} from "@/lib/loan-actions";
import {
  formatPercent,
  formatUsdPrice,
  getLtvRiskTier,
  loanLiquidationPrice,
  loanLtvPercent,
  parseAmount,
  parseInterestPercent,
} from "@/lib/loan-metrics";
import styles from "./LoanActionModal.module.css";

export type LoanActionType =
  | "addCollateral"
  | "withdrawCollateral"
  | "borrow"
  | "repay";

interface Props {
  action: LoanActionType;
  loan: Loan;
  abdPrice: string | null;
  alphPrice: string | null;
  alphBalance: number;
  abdBalance: number;
  walletAddress: string;
  signer: SignerProvider;
  onClose: () => void;
  onSuccess: (txId: string) => void;
}

interface ActionMeta {
  title: string;
  token: string;
  verb: string;
  description: string;
}

const ACTION_META: Record<LoanActionType, ActionMeta> = {
  addCollateral: {
    title: "Add Collateral",
    token: "ALPH",
    verb: "Deposit",
    description: "Deposit ALPH to increase your collateral and improve your LTV.",
  },
  withdrawCollateral: {
    title: "Withdraw Collateral",
    token: "ALPH",
    verb: "Withdraw",
    description: "Remove ALPH collateral — LTV must stay at or above 200%.",
  },
  borrow: {
    title: "Borrow",
    token: "ABD",
    verb: "Borrow",
    description: "Borrow ABD against your collateral — LTV must stay at or above 200%.",
  },
  repay: {
    title: "Repay",
    token: "ABD",
    verb: "Repay",
    description: "Repay ABD debt to improve your LTV and health factor.",
  },
};

function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val));
}

function computeMax(
  action: LoanActionType,
  loan: Loan,
  alphBalance: number,
  abdBalance: number,
  abdPrice: string | null,
  alphPrice: string | null,
  zeroFeeRemaining: number | null,
): number {
  const collateral = parseAmount(loan.collateral);
  const debt = parseAmount(loan.debt);
  const abdUsd = abdPrice ? parseFloat(abdPrice) : null;
  const alphUsd = alphPrice ? parseFloat(alphPrice) : null;

  switch (action) {
    case "addCollateral":
      return Math.max(0, alphBalance - GAS_RESERVE_ALPH);

    case "withdrawCollateral": {
      if (!abdUsd || !alphUsd || debt === 0) return collateral;
      const minCollateral = (2 * debt * abdUsd) / alphUsd;
      return Math.max(0, collateral - minCollateral);
    }

    case "borrow": {
      if (!abdUsd || !alphUsd) return 0;
      const maxDebt = (collateral * alphUsd) / (2 * abdUsd);
      const ltvMax = Math.max(0, maxDebt - debt);
      // 0% loans are capped by the ABX-stake-based zero-fee tier limit
      if (zeroFeeRemaining !== null) return Math.min(ltvMax, zeroFeeRemaining);
      return ltvMax;
    }

    case "repay":
      return Math.min(debt, abdBalance);
  }
}

function previewLtv(
  action: LoanActionType,
  loan: Loan,
  amount: number,
  abdPrice: string | null,
  alphPrice: string | null,
): number | null {
  const c = parseAmount(loan.collateral);
  const d = parseAmount(loan.debt);

  switch (action) {
    case "addCollateral":
      return loanLtvPercent(
        String(d),
        String(c + amount),
        abdPrice,
        alphPrice,
      );
    case "withdrawCollateral":
      return loanLtvPercent(
        String(d),
        String(Math.max(0, c - amount)),
        abdPrice,
        alphPrice,
      );
    case "borrow":
      return loanLtvPercent(
        String(d + amount),
        String(c),
        abdPrice,
        alphPrice,
      );
    case "repay":
      return d - amount <= 0
        ? null
        : loanLtvPercent(
            String(Math.max(0, d - amount)),
            String(c),
            abdPrice,
            alphPrice,
          );
  }
}

function previewLiqPrice(
  action: LoanActionType,
  loan: Loan,
  amount: number,
  abdPrice: string | null,
): number | null {
  const c = parseAmount(loan.collateral);
  const d = parseAmount(loan.debt);

  switch (action) {
    case "addCollateral":
      return loanLiquidationPrice(String(d), String(c + amount), abdPrice);
    case "withdrawCollateral":
      return loanLiquidationPrice(
        String(d),
        String(Math.max(0, c - amount)),
        abdPrice,
      );
    case "borrow":
      return loanLiquidationPrice(String(d + amount), String(c), abdPrice);
    case "repay":
      return d - amount <= 0
        ? null
        : loanLiquidationPrice(
            String(Math.max(0, d - amount)),
            String(c),
            abdPrice,
          );
  }
}

export function LoanActionModal({
  action,
  loan,
  abdPrice,
  alphPrice,
  alphBalance,
  abdBalance,
  walletAddress,
  signer,
  onClose,
  onSuccess,
}: Props) {
  const meta = ACTION_META[action];

  // ── Interest rate picker (borrow only) ──────────────────────────────────
  const currentRate = parseInterestPercent(loan.interestRate);
  const defaultRate = currentRate && currentRate > 0 ? currentRate : 5;
  const [availableRates, setAvailableRates] = useState<number[]>([]);
  const [selectedRate, setSelectedRate] = useState<number>(defaultRate);
  const [mintingFeeAlph, setMintingFeeAlph] = useState<number | null>(null);

  useEffect(() => {
    if (action !== "borrow") return;
    getAvailableInterestRates()
      .then((rates) => {
        setAvailableRates(rates);
        const pre = currentRate && rates.includes(currentRate) ? currentRate : (rates[2] ?? rates[0] ?? 5);
        setSelectedRate(pre);
      })
      .catch(() => setAvailableRates([1, 3, 5, 10, 15, 20, 25, 30]));
    // Fetch minting fee for collateral display
    const collateralAtto = toAttoUnits(parseAmount(loan.collateral));
    getMintingFeeAtto(collateralAtto)
      .then((fee: bigint) => setMintingFeeAlph(fromAttoUnits(fee)))
      .catch(() => setMintingFeeAlph(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  // ── Zero-fee borrow cap (0% loans only) ─────────────────────────────────
  const isZeroFee = action === "borrow" && selectedRate === 0;
  const [zeroFeeRemaining, setZeroFeeRemaining] = useState<number | null>(null);
  const [zeroFeeLoading, setZeroFeeLoading] = useState(false);

  useEffect(() => {
    if (!isZeroFee) return;
    setZeroFeeLoading(true);
    getUserZeroFeeRemainingDebt(walletAddress, toAttoUnits(parseAmount(loan.debt), ABD_DECIMALS))
      .then(setZeroFeeRemaining)
      .catch(() => setZeroFeeRemaining(0))
      .finally(() => setZeroFeeLoading(false));
  }, [isZeroFee, walletAddress, loan.debt]);

  const maxAmount = useMemo(
    () =>
      computeMax(
        action, loan, alphBalance, abdBalance, abdPrice, alphPrice,
        isZeroFee ? zeroFeeRemaining : null,
      ),
    [action, loan, alphBalance, abdBalance, abdPrice, alphPrice, isZeroFee, zeroFeeRemaining],
  );

  const [inputValue, setInputValue] = useState("");
  const [sliderPct, setSliderPct] = useState(0);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const amount = useMemo(() => {
    const n = parseFloat(inputValue);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [inputValue]);

  const resultLtv = useMemo(
    () => (amount > 0 ? previewLtv(action, loan, amount, abdPrice, alphPrice) : null),
    [action, loan, amount, abdPrice, alphPrice],
  );
  const resultLiqPrice = useMemo(
    () =>
      amount > 0 ? previewLiqPrice(action, loan, amount, abdPrice) : null,
    [action, loan, amount, abdPrice],
  );

  const resultRiskTier = resultLtv !== null ? getLtvRiskTier(resultLtv) : null;
  const isInvalid =
    amount <= 0 ||
    amount > maxAmount ||
    (resultLtv !== null && resultLtv < 200 && action !== "repay");

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setInputValue(raw);
      const n = parseFloat(raw);
      if (Number.isFinite(n) && maxAmount > 0) {
        setSliderPct(clamp(Math.round((n / maxAmount) * 100), 0, 100));
      }
    },
    [maxAmount],
  );

  const handleSlider = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const pct = Number(e.target.value);
      setSliderPct(pct);
      if (maxAmount > 0) {
        const val = (pct / 100) * maxAmount;
        setInputValue(String(Math.round(val * 1e6) / 1e6));
      }
    },
    [maxAmount],
  );

  const handleMax = useCallback(() => {
    if (maxAmount <= 0) return;
    setInputValue(String(Math.round(maxAmount * 1e6) / 1e6));
    setSliderPct(100);
  }, [maxAmount]);

  const handleConfirm = useCallback(async () => {
    if (isInvalid || status === "submitting") return;
    setStatus("submitting");
    setErrorMsg("");
    try {
      let txId: string;
      switch (action) {
        case "addCollateral":
          txId = await addCollateralTx(signer, amount);
          break;
        case "withdrawCollateral":
          txId = await withdrawCollateralTx(signer, walletAddress, amount);
          break;
        case "borrow":
          txId = await borrowAbdTx(
            signer,
            walletAddress,
            amount,
            selectedRate,
            parseAmount(loan.collateral),
            parseAmount(loan.debt),
          );
          break;
        case "repay":
          txId = await repayAbdTx(signer, amount);
          break;
      }
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
  }, [action, amount, isInvalid, onClose, onSuccess, signer, status, walletAddress]);

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

  const currentLtv = loanLtvPercent(loan.debt, loan.collateral, abdPrice, alphPrice);
  const currentLiqPrice = loanLiquidationPrice(loan.debt, loan.collateral, abdPrice);

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.dialog} role="dialog" aria-modal="true">
        {/* Header */}
        <div className={styles.dialogHeader}>
          <div>
            <span className={styles.dialogEyebrow}>Loan Action</span>
            <h2 className={styles.dialogTitle}>{meta.title}</h2>
          </div>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <p className={styles.description}>{meta.description}</p>

        {isZeroFee && (
          <p className={styles.zeroFeeNote}>
            {zeroFeeLoading
              ? "Checking your zero-fee borrow limit…"
              : zeroFeeRemaining !== null
                ? `0% loan — your ABX stake allows up to ${zeroFeeRemaining.toFixed(2)} more ABD at zero fee.`
                : null}
          </p>
        )}

        {/* Interest rate picker — borrow only */}
        {action === "borrow" && availableRates.length > 0 && (
          <div className={styles.rateSection}>
            <span className={styles.rateLabel}>Loan Interest Rate</span>
            <div className={styles.rateGrid}>
              {availableRates.map((rate) => (
                <button
                  key={rate}
                  className={`${styles.rateBtn} ${selectedRate === rate ? styles.rateBtnActive : ""}`}
                  onClick={() => setSelectedRate(rate)}
                  disabled={status === "submitting" || status === "success"}
                >
                  {rate}%
                </button>
              ))}
            </div>
            {mintingFeeAlph !== null && (
              <div className={styles.mintingFeeRow}>
                <span className={styles.mintingFeeLabel}>Minting Fee (0.5%)</span>
                <span className={styles.mintingFeeValue}>{mintingFeeAlph.toFixed(4)} ALPH</span>
              </div>
            )}
          </div>
        )}

        {/* Current metrics */}
        <div className={styles.metricsRow}>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>Current LTV</span>
            <span className={styles.metricValue}>
              {currentLtv !== null ? formatPercent(currentLtv) : "—"}
            </span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>Liq. Price</span>
            <span className={styles.metricValue}>
              {currentLiqPrice !== null ? formatUsdPrice(currentLiqPrice) : "—"}
            </span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>
              {meta.token === "ALPH" ? "ALPH Balance" : "ABD Balance"}
            </span>
            <span className={styles.metricValue}>
              {meta.token === "ALPH"
                ? `${alphBalance.toFixed(4)} ALPH`
                : `${abdBalance.toFixed(4)} ABD`}
            </span>
          </div>
        </div>

        {/* Amount input */}
        <div className={styles.inputSection}>
          <div className={styles.inputLabel}>
            <span>Amount</span>
            <span className={styles.maxAvail}>
              Max:{" "}
              <button className={styles.maxLink} onClick={handleMax}>
                {maxAmount.toFixed(4)} {meta.token}
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
              onChange={handleInputChange}
              min={0}
              max={maxAmount}
              step="any"
              disabled={status === "submitting" || status === "success"}
            />
            <span className={styles.tokenLabel}>{meta.token}</span>
            <button
              className={styles.maxBtn}
              onClick={handleMax}
              disabled={status === "submitting" || status === "success"}
            >
              MAX
            </button>
          </div>

          {/* Slider */}
          <div className={styles.sliderRow}>
            <span className={styles.sliderPct}>{sliderPct}%</span>
            <input
              type="range"
              className={styles.slider}
              min={0}
              max={100}
              step={1}
              value={sliderPct}
              onChange={handleSlider}
              disabled={status === "submitting" || status === "success"}
            />
          </div>
        </div>

        {/* Preview */}
        {amount > 0 && (
          <div className={styles.preview}>
            <span className={styles.previewTitle}>After Transaction</span>
            <div className={styles.previewRow}>
              <span className={styles.previewLabel}>Resulting LTV</span>
              {resultLtv !== null && resultRiskTier ? (
                <span
                  className={styles.previewValue}
                  style={{ color: resultRiskTier.color }}
                >
                  {formatPercent(resultLtv)}
                  <span className={styles.riskLabel}>{resultRiskTier.label}</span>
                </span>
              ) : (
                <span className={styles.previewValue}>—</span>
              )}
            </div>
            <div className={styles.previewRow}>
              <span className={styles.previewLabel}>Resulting Liq. Price</span>
              <span className={styles.previewValue}>
                {resultLiqPrice !== null ? formatUsdPrice(resultLiqPrice) : "—"}
              </span>
            </div>
            {isInvalid && amount > 0 && amount <= maxAmount && resultLtv !== null && resultLtv < 200 && (
              <p className={styles.warnLtv}>
                LTV would fall below 200% — reduce amount.
              </p>
            )}
          </div>
        )}

        {/* Error */}
        {status === "error" && errorMsg && (
          <p className={styles.errorMsg}>{errorMsg}</p>
        )}

        {/* Success */}
        {status === "success" && (
          <p className={styles.successMsg}>Transaction submitted!</p>
        )}

        {/* Actions */}
        <div className={styles.dialogFooter}>
          <button
            className={styles.cancelBtn}
            onClick={onClose}
            disabled={status === "submitting"}
          >
            Cancel
          </button>
          <button
            className={styles.confirmBtn}
            onClick={handleConfirm}
            disabled={
              isInvalid ||
              status === "submitting" ||
              status === "success" ||
              amount > maxAmount
            }
          >
            {status === "submitting" ? (
              <span className={styles.spinner} />
            ) : (
              `${meta.verb} ${amount > 0 ? `${(Math.round(amount * 1e4) / 1e4).toFixed(4)} ${meta.token}` : meta.token}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
