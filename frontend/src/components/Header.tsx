"use client";

import { sendEvent } from "@socialgouv/matomo-next";
import { ConnectWalletButton } from "./ConnectWalletButton";
import styles from "./Header.module.css";

const NAV_ITEMS = [
  { label: "LOANS", href: "#loans", active: true, external: false },
  { label: "AUCTIONS", href: "https://app.alphbanx.com", active: false, external: true },
  { label: "STAKING", href: "https://app.alphbanx.com", active: false, external: true },
  { label: "ABX", href: "https://app.alphbanx.com", active: false, external: true },
] as const;

export function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
            <path
              d="M16 2L28 28H22L19.5 22H12.5L10 28H4L16 2Z"
              fill="var(--accent-green)"
              opacity="0.9"
            />
            <path d="M13.5 17H18.5L16 11.5L13.5 17Z" fill="#050505" />
          </svg>
          <div>
            <div className={styles.brandRow}>
              <span className={styles.brandName}>AlphBanX</span>
              <span className={styles.brandBadge}>MIRROR</span>
            </div>
            <span className={styles.brandSub}>LENDING PROTOCOL</span>
          </div>
        </div>

        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className={`${styles.navLink} ${item.active ? styles.navLinkActive : ""}`}
              {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              onClick={() =>
                sendEvent({
                  category: "navigation",
                  action: "click",
                  name: item.label.toLowerCase(),
                })
              }
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className={styles.actions}>
          <div className={styles.network}>
            <span className={styles.networkDot} />
            Mainnet
          </div>
          <ConnectWalletButton />
        </div>
      </div>
    </header>
  );
}
