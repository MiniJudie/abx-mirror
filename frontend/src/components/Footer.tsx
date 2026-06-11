import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.verifyBar}>
        <div className={styles.verifyInner}>
          <span className={styles.verifyText}>
            <span className={styles.verifyIcon}>⚠</span>
            Community mirror — not the official interface. Verify all data on-chain.
          </span>
          <div className={styles.verifyLinks}>
            <a
              href="https://explorer.alephium.org"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.verifyLink}
            >
              Verify on Explorer ↗
            </a>
            <a
              href="https://docs.alphbanx.com"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.verifyLink}
            >
              Audits &amp; Docs ↗
            </a>
          </div>
        </div>
      </div>

      <div className={styles.main}>
        <div className={styles.mainInner}>
          <div className={styles.brandCol}>
            <div className={styles.brandRow}>
              <svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden>
                <path d="M16 2L28 28H22L19.5 22H12.5L10 28H4L16 2Z" fill="var(--accent-green)" />
                <path d="M13.5 17H18.5L16 11.5L13.5 17Z" fill="#050505" />
              </svg>
              <span className={styles.brandName}>AlphBanX</span>
              <span className={styles.brandBadge}>MIRROR</span>
            </div>
            <p className={styles.brandDesc}>
              Community-run mirror interface for the AlphBanX lending protocol on Alephium.
            </p>
          </div>

          <div className={styles.linkCol}>
            <span className={styles.colTitle}>PROTOCOL</span>
            <a href="#loans">Loans</a>
            <a href="https://app.alphbanx.com" target="_blank" rel="noopener noreferrer">Auctions</a>
            <a href="https://app.alphbanx.com" target="_blank" rel="noopener noreferrer">Staking</a>
            <a href="https://app.alphbanx.com" target="_blank" rel="noopener noreferrer">ABX Token</a>
          </div>

          <div className={styles.linkCol}>
            <span className={styles.colTitle}>COMMUNITY</span>
            <a href="https://discord.gg/alephium" target="_blank" rel="noopener noreferrer">Discord</a>
            <a href="https://x.com/Alephium" target="_blank" rel="noopener noreferrer">Twitter</a>
            <a href="https://github.com/alephium" target="_blank" rel="noopener noreferrer">GitHub</a>
          </div>

          <div className={styles.linkCol}>
            <span className={styles.colTitle}>RESOURCES</span>
            <a href="https://docs.alphbanx.com" target="_blank" rel="noopener noreferrer">Documentation</a>
            <a href="https://explorer.alephium.org" target="_blank" rel="noopener noreferrer">Explorer</a>
            <a href="https://alephium.org" target="_blank" rel="noopener noreferrer">Alephium</a>
          </div>

          <div className={styles.disclaimerCol}>
            <span className={styles.colTitle}>DISCLAIMER</span>
            <p>
              This is a community-hosted mirror interface. It is not affiliated with or
              endorsed by the AlphBanX team. Always verify contract addresses and
              transaction details before signing. Use at your own risk.
            </p>
          </div>
        </div>
      </div>

      <div className={styles.copyright}>
        © 2024 AlphBanX Mirror. Community-run interface for Alephium.
      </div>
    </footer>
  );
}
