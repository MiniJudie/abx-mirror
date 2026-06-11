"use client";

import { AlephiumConnectButtonCustom } from "@alephium/web3-react";
import { sendEvent } from "@socialgouv/matomo-next";
import styles from "./Header.module.css";

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function ConnectWalletButton() {
  return (
    <AlephiumConnectButtonCustom
      displayAccount={(account) => truncateAddress(account.address)}
    >
      {({ show, isConnected, truncatedAddress }) => (
        <button
          type="button"
          className={
            isConnected
              ? `${styles.walletButton} ${styles.walletButtonConnected}`
              : styles.walletButton
          }
          onClick={() => {
            sendEvent({
              category: "navigation",
              action: "click",
              name: isConnected ? "wallet_profile" : "connect_wallet",
            });
            show?.();
          }}
        >
          {isConnected && truncatedAddress ? (
            <>
              <span className={styles.walletDot} aria-hidden />
              <span className={styles.walletAddress}>{truncatedAddress}</span>
            </>
          ) : (
            "CONNECT WALLET"
          )}
        </button>
      )}
    </AlephiumConnectButtonCustom>
  );
}
