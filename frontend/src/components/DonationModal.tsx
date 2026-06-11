"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@alephium/web3-react";
import { convertAlphAmountWithDecimals } from "@alephium/web3";
import { fetchOraclePrice } from "@/lib/api";
import { ConnectWalletButton } from "./ConnectWalletButton";
import styles from "./DonationModal.module.css";

const DEV_ADDRESS = "1GScff1aZBs3yw2vhNB7tij2eSzTrU9Tdx3CZzCgwZmrm";
const USD_TIERS = [1, 5, 10, 20, 100];
const FALLBACK_PRICE = 0.033;

/** Round to a nice number: 1 sig fig if <10, else nearest 5/10 */
function roundAlph(alph: number): number {
  if (alph < 5) return Math.round(alph);
  if (alph < 20) return Math.round(alph / 5) * 5;
  if (alph < 100) return Math.round(alph / 10) * 10;
  if (alph < 1000) return Math.round(alph / 50) * 50;
  return Math.round(alph / 100) * 100;
}

interface Props {
  onClose: () => void;
}

export function DonationModal({ onClose }: Props) {
  const wallet = useWallet();
  const [alphPrice, setAlphPrice] = useState<number>(FALLBACK_PRICE);
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [txId, setTxId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Presets derived from live price
  const presets = USD_TIERS.map((usd) => ({
    usd,
    alph: roundAlph(usd / alphPrice),
  }));
  const [selectedUsd, setSelectedUsd] = useState(5);
  const [customAlph, setCustomAlph] = useState<string | null>(null);

  const activePreset = presets.find((p) => p.usd === selectedUsd)!;
  const displayAlph = customAlph ?? String(activePreset.alph);

  useEffect(() => {
    fetchOraclePrice()
      .then((p) => {
        const price = parseFloat(p.alphUsd);
        if (price > 0) setAlphPrice(price);
      })
      .catch(() => {/* keep fallback */});
  }, []);

  async function handleDonate() {
    if (!wallet.signer || !wallet.account) return;
    const attoAlph = convertAlphAmountWithDecimals(displayAlph);
    if (!attoAlph || attoAlph <= BigInt(0)) {
      setErrorMsg("Invalid amount");
      return;
    }
    setStatus("pending");
    setErrorMsg(null);
    try {
      const result = await wallet.signer.signAndSubmitTransferTx({
        signerAddress: wallet.account.address,
        destinations: [{ address: DEV_ADDRESS, attoAlphAmount: attoAlph.toString() }],
      });
      setTxId(result.txId);
      setStatus("success");
    } catch (e: unknown) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Transaction failed");
    }
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <button className={styles.close} onClick={onClose} aria-label="Close">
          ✕
        </button>

        <div className={styles.icon}>♥</div>
        <h2 className={styles.title}>Support the Dev</h2>
        <p className={styles.desc}>
          This mirror is built and maintained independently. <br/>If you find it useful,
          any ALPH donation is greatly appreciated, it will help cover the costs of running the mirror and to support more features and other mirrors.
          <br />
          <span className={styles.priceHint}>1 ALPH ≈ ${alphPrice.toFixed(3)}</span>
        </p>

        <div className={styles.addrRow}>
          <span className={styles.addrLabel}>To</span>
          <span className={styles.addr} title={DEV_ADDRESS}>
            {DEV_ADDRESS.slice(0, 10)}…{DEV_ADDRESS.slice(-6)}
          </span>
        </div>

        {status === "success" ? (
          <div className={styles.success}>
            <div className={styles.successIcon}>✓</div>
            <p>Thank you! Transaction submitted.</p>
            <a
              href={`https://explorer.alephium.org/transactions/${txId}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.txLink}
            >
              View on Explorer ↗
            </a>
            <button className={styles.doneBtn} onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <div className={styles.presets}>
              {presets.map(({ usd, alph }) => (
                <button
                  key={usd}
                  className={`${styles.preset} ${selectedUsd === usd && !customAlph ? styles.presetActive : ""}`}
                  onClick={() => { setSelectedUsd(usd); setCustomAlph(null); }}
                  disabled={status === "pending"}
                >
                  <span className={styles.presetUsd}>${usd}</span>
                  <span className={styles.presetAlph}>{alph} ALPH</span>
                </button>
              ))}
            </div>

            <div className={styles.inputRow}>
              <input
                className={styles.input}
                type="number"
                min="1"
                step="1"
                value={displayAlph}
                onChange={(e) => setCustomAlph(e.target.value)}
                disabled={status === "pending"}
              />
              <span className={styles.inputUnit}>ALPH</span>
            </div>

            {errorMsg && <p className={styles.error}>{errorMsg}</p>}

            {!wallet.account ? (
              <div className={styles.connectWrap}>
                <p className={styles.connectHint}>Connect your wallet to donate.</p>
                <ConnectWalletButton />
              </div>
            ) : (
              <button
                className={styles.donateBtn}
                onClick={handleDonate}
                disabled={status === "pending"}
              >
                {status === "pending" ? "Sending…" : `Donate ${displayAlph} ALPH`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
