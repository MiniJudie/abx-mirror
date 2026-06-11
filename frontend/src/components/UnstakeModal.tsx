"use client";

import { useRef, useState } from "react";
import { useWallet } from "@alephium/web3-react";
import { formatNumber } from "@/lib/format";
import { unstakeAbx } from "@/lib/stake-actions";
import styles from "./StakeModal.module.css"; // reuse same styles

interface Props {
  stakedAbx: string; // display-formatted max amount
  onClose: () => void;
  /** Called immediately when the tx is broadcast. */
  onTxSubmitted: (txId: string) => void;
}

export function UnstakeModal({ stakedAbx, onClose, onTxSubmitted }: Props) {
  const { signer } = useWallet();
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const maxAmount = parseFloat(stakedAbx) || 0;
  const amountNum = parseFloat(amount) || 0;
  const isValid = amountNum > 0 && amountNum <= maxAmount;

  async function handleUnstake() {
    if (!signer || !isValid) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const txId = await unstakeAbx(signer, amountNum);
      onTxSubmitted(txId);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      setErrorMsg(msg.length > 140 ? msg.slice(0, 140) + "…" : msg);
      setSubmitting(false);
    }
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current && !submitting) onClose();
  }

  return (
    <div className={styles.backdrop} ref={backdropRef} onClick={handleBackdropClick}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Unstake ABX">
        <div className={styles.header}>
          <span className={styles.title}>Unstake ABX</span>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.balanceRow}>
            <span className={styles.balanceLabel}>Currently Staked</span>
            <span className={styles.balanceValue}>
              {formatNumber(maxAmount, { maximumFractionDigits: 4 })} ABX
            </span>
          </div>

          <div className={styles.inputRow}>
            <input
              className={styles.amountInput}
              type="number"
              min="0"
              step="any"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={submitting}
              autoFocus
            />
            <button
              className={styles.maxBtn}
              onClick={() => setAmount(maxAmount.toString())}
              disabled={submitting || maxAmount === 0}
            >
              MAX
            </button>
          </div>

          {errorMsg && <div className={styles.errorMsg}>{errorMsg}</div>}

          <div className={styles.stakeNote}>
            Unstaking begins a <strong>vesting period</strong>. Tokens will not
            be immediately withdrawable — you will need to call an unlock
            transaction once the vesting period ends.
          </div>

          <button
            className={styles.stakeBtn}
            style={{ background: "#ef4444" }}
            onClick={handleUnstake}
            disabled={!isValid || submitting || !signer}
          >
            {submitting ? "Waiting for wallet…" : "Unstake ABX"}
          </button>
        </div>
      </div>
    </div>
  );
}
