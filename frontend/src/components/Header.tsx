"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { sendEvent } from "@socialgouv/matomo-next";
import { ConnectWalletButton } from "./ConnectWalletButton";
import { DonationModal } from "./DonationModal";
import styles from "./Header.module.css";

const NAV_ITEMS = [
  { label: "LOANS", href: "/", external: false },
  { label: "AUCTIONS", href: "/auction", external: false },
  { label: "STAKING", href: "/staking", external: false },
  { label: "ABX/ABD", href: "/abx-abd", external: false },
  { label: "ALPHBANX", href: "https://app.alphbanx.com", external: true },
] as const;

export function Header() {
  const pathname = usePathname();
  const [donateOpen, setDonateOpen] = useState(false);

  return (
    <>
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
          {NAV_ITEMS.map((item) => {
            const isActive = !item.external && pathname === item.href;
            if (item.external) {
              return (
                <a
                  key={item.label}
                  href={item.href}
                  className={styles.navLink}
                  target="_blank"
                  rel="noopener noreferrer"
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
              );
            }
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`${styles.navLink} ${isActive ? styles.navLinkActive : ""}`}
                onClick={() =>
                  sendEvent({
                    category: "navigation",
                    action: "click",
                    name: item.label.toLowerCase(),
                  })
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className={styles.actions}>
          <div className={styles.network}>
            <span className={styles.networkDot} />
            Mainnet
          </div>
          <button
            className={styles.donateBtn}
            onClick={() => setDonateOpen(true)}
            title="Support the dev"
          >
            ♥
          </button>
          <ConnectWalletButton />
        </div>
      </div>
    </header>

    {donateOpen && <DonationModal onClose={() => setDonateOpen(false)} />}
    </>
  );
}
