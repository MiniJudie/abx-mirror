"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@alephium/web3-react";
import { ConnectWalletButton } from "./ConnectWalletButton";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { redeemAbd } from "@/lib/redeem-actions";
import { fetchOraclePrice } from "@/lib/api";
import styles from "./RedeemAbdPanel.module.css";

function formatNum(n: number, maxDec = 4): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDec,
  });
}

export function RedeemAbdPanel() {
  const wallet = useWallet();
  const address = wallet.account?.address;
  const { abdBalance, alphBalance, loading: balLoading, refresh } = useWalletBalances(address);

  const [abdInput, setAbdInput] = useState("");
  const [slippagePct, setSlippagePct] = useState("1");
  const [alphPrice, setAlphPrice] = useState<number | null>(null);
  const [abdPrice, setAbdPrice] = useState<number | null>(null);
  const [txState, setTxState] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [txId, setTxId] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchOraclePrice()
      .then((p) => {
        setAlphPrice(parseFloat(p.alphUsd));
        setAbdPrice(parseFloat(p.abdUsd));
      })
      .catch(() => {});
  }, []);

  const abdAmt = parseFloat(abdInput) || 0;
  const estAlph =
    abdAmt > 0 && alphPrice && abdPrice && alphPrice > 0
      ? (abdAmt * abdPrice) / alphPrice
      : 0;
  const slippageNum = parseFloat(slippagePct) || 1;
  const minAlph = estAlph * (1 - slippageNum / 100);

  const handleMax = useCallback(() => {
    if (abdBalance != null) setAbdInput(abdBalance.toFixed(4));
  }, [abdBalance]);

  const handleSubmit = useCallback(async () => {
    if (!wallet.signer || !address || abdAmt <= 0) return;
    setTxState("pending");
    setErrMsg(null);
    setTxId(null);
    try {
      const id = await redeemAbd({
        signer: wallet.signer,
        walletAddress: address,
        abdAmount: abdAmt,
      });
      setTxId(id);
      setTxState("success");
      setAbdInput("");
      refresh();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
      setTxState("error");
    }
  }, [wallet.signer, address, abdAmt, minAlph, refresh]);

  const resetTx = useCallback(() => {
    setTxState("idle");
    setTxId(null);
    setErrMsg(null);
  }, []);

  const isDisabled =
    txState === "pending" ||
    abdAmt <= 0 ||
    (abdBalance != null && abdAmt > abdBalance);

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Redeem ABD</h2>
          <p className={styles.subtitle}>
            Burn ABD to receive ALPH at the oracle price. Redemption targets the
            least-collateralised loans first.
          </p>
        </div>
        {!address && (
          <div className={styles.connectWrap}>
            <ConnectWalletButton />
          </div>
        )}
      </div>

      {address && (
        txState === "success" && txId ? (
          <div className={styles.successBox}>
            <p className={styles.successText}>Transaction submitted!</p>
            <a
              href={`https://explorer.alephium.org/transactions/${txId}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.txLink}
            >
              View on Explorer ↗
            </a>
            <button className={styles.resetBtn} onClick={resetTx}>
              Redeem again
            </button>
          </div>
        ) : (
          <div className={styles.body}>
            {/* Left: inputs */}
            <div className={styles.leftCol}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>ABD amount to redeem</label>
                <div className={styles.inputRow}>
                  <input
                    type="number"
                    className={styles.input}
                    placeholder="0.00"
                    min="0"
                    value={abdInput}
                    onChange={(e) => setAbdInput(e.target.value)}
                    disabled={txState === "pending"}
                  />
                  <button
                    className={styles.maxBtn}
                    onClick={handleMax}
                    disabled={txState === "pending"}
                  >
                    MAX
                  </button>
                </div>
                {abdBalance != null && (
                  <span className={styles.balHint}>
                    Available: <strong>{formatNum(abdBalance, 4)} ABD</strong>
                  </span>
                )}
              </div>

              <div className={styles.inputGroup}>
                <label className={styles.label}>Slippage tolerance</label>
                <div className={styles.slippageRow}>
                  {["0.5", "1", "2"].map((v) => (
                    <button
                      key={v}
                      className={`${styles.slippagePreset} ${slippagePct === v ? styles.slippageActive : ""}`}
                      onClick={() => setSlippagePct(v)}
                      disabled={txState === "pending"}
                    >
                      {v}%
                    </button>
                  ))}
                  <div className={styles.slippageCustomWrap}>
                    <input
                      type="number"
                      className={styles.slippageInput}
                      placeholder="Custom"
                      min="0.1"
                      max="50"
                      step="0.1"
                      value={["0.5", "1", "2"].includes(slippagePct) ? "" : slippagePct}
                      onChange={(e) => setSlippagePct(e.target.value || "1")}
                      disabled={txState === "pending"}
                    />
                    <span className={styles.slippageSuffix}>%</span>
                  </div>
                </div>
              </div>

              {errMsg && (
                <div className={styles.errorBox}>
                  <span>{errMsg}</span>
                  <button className={styles.errorClose} onClick={resetTx}>✕</button>
                </div>
              )}
            </div>

            {/* Right: summary + action */}
            <div className={styles.rightCol}>
              <div className={styles.summaryCard}>
                <p className={styles.summaryTitle}>Wallet</p>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>ABD balance</span>
                  <span className={styles.summaryValue}>
                    {balLoading ? "…" : abdBalance != null ? formatNum(abdBalance, 4) : "—"} ABD
                  </span>
                </div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>ALPH balance</span>
                  <span className={styles.summaryValue}>
                    {balLoading ? "…" : alphBalance != null ? formatNum(alphBalance, 2) : "—"} ALPH
                  </span>
                </div>

                <div className={styles.divider} />

                <p className={styles.summaryTitle}>Output</p>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Estimated ALPH</span>
                  <span className={`${styles.summaryValue} ${styles.summaryHighlight}`}>
                    {abdAmt > 0 && estAlph > 0 ? `≈ ${formatNum(estAlph, 4)}` : "—"} ALPH
                  </span>
                </div>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Minimum ALPH</span>
                  <span className={styles.summaryValue}>
                    {abdAmt > 0 && minAlph > 0 ? formatNum(Math.max(0, minAlph), 4) : "—"} ALPH
                  </span>
                </div>

                {alphPrice && abdPrice && (
                  <>
                    <div className={styles.divider} />
                    <p className={styles.summaryTitle}>Oracle</p>
                    <div className={styles.summaryRow}>
                      <span className={styles.summaryLabel}>ALPH price</span>
                      <span className={styles.summaryValue}>${formatNum(alphPrice, 4)}</span>
                    </div>
                    <div className={styles.summaryRow}>
                      <span className={styles.summaryLabel}>ABD price</span>
                      <span className={styles.summaryValue}>${formatNum(abdPrice, 4)}</span>
                    </div>
                  </>
                )}
              </div>

              <button
                className={styles.submitBtn}
                onClick={handleSubmit}
                disabled={isDisabled}
              >
                {txState === "pending" ? "Confirming…" : "Redeem ABD"}
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}
