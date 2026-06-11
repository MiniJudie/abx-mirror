"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@alephium/web3-react";
import { formatNumber } from "@/lib/format";
import { stakeAbx, fetchWalletAbxBalance } from "@/lib/stake-actions";
import styles from "./StakeModal.module.css";

interface Props {
  onClose: () => void;
  /** Called immediately when the tx is broadcast — modal closes at this point. */
  onTxSubmitted: (txId: string) => void;
}

export function StakeModal({ onClose, onTxSubmitted }: Props) {
  const { account, signer } = useWallet();
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (account?.address) {
      fetchWalletAbxBalance(account.address).then(setBalance).catch(() => setBalance(0));
    }
  }, [account?.address]);

  const amountNum = parseFloat(amount) || 0;
  const balanceNum = balance ?? 0;
  const isValid = amountNum > 0 && amountNum <= balanceNum;

  async function handleStake() {
    if (!signer || !isValid) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const txId = await stakeAbx(signer, amountNum);
      // Close the modal right away and hand off the txId to the parent panel
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
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Stake ABX">
        <div className={styles.header}>
          <span className={styles.title}>Stake ABX</span>
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
            <span className={styles.balanceLabel}>Available ABX</span>
            <span className={styles.balanceValue}>
              {balance === null
                ? "Loading…"
                : formatNumber(balanceNum, { maximumFractionDigits: 4 })}
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
              onClick={() => setAmount(balanceNum.toString())}
              disabled={submitting || balanceNum === 0}
            >
              MAX
            </button>
          </div>

          {errorMsg && <div className={styles.errorMsg}>{errorMsg}</div>}

          <div className={styles.stakeNote}>
            Staked ABX earns ALPH from protocol borrowing fees. Tokens enter a{" "}
            <strong>vesting period</strong> when unstaked before becoming withdrawable.
          </div>

          <button
            className={styles.stakeBtn}
            onClick={handleStake}
            disabled={!isValid || submitting || !signer}
          >
            {submitting ? "Waiting for wallet…" : "Stake ABX"}
          </button>
        </div>
      </div>
    </div>
  );
}
