import styles from "./WarningBanner.module.css";

export function WarningBanner() {
  return (
    <div className={styles.banner}>
      <span className={styles.icon}>⚠</span>
      <div>
        <strong>Community mirror — not the official interface.</strong>
        <span className={styles.sub}>
          {" "}Data is indexed from Alephium mainnet and refreshed every 5 minutes. Always verify contract addresses and transaction details before signing.
        </span>
      </div>
    </div>
  );
}
