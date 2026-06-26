"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { sendEvent } from "@socialgouv/matomo-next";
import { ROUTES, isActiveRoute } from "@/lib/routes";
import { ConnectWalletButton } from "./ConnectWalletButton";
import { DonationModal } from "./DonationModal";
import styles from "./Header.module.css";

const NAV_ITEMS = [
  { label: "LOANS", href: ROUTES.home, external: false },
  { label: "AUCTIONS", href: ROUTES.auction, external: false },
  { label: "STAKING", href: ROUTES.staking, external: false },
  { label: "ABX/ABD", href: ROUTES.abxAbd, external: false },
  { label: "ALPHBANX", href: "https://app.alphbanx.com", external: true },
] as const;

function trackNavClick(label: string) {
  sendEvent({
    category: "navigation",
    action: "click",
    name: label.toLowerCase(),
  });
}

export function Header() {
  const pathname = usePathname();
  const [donateOpen, setDonateOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  function renderNavItem(item: (typeof NAV_ITEMS)[number], className: string) {
    const isActive = !item.external && isActiveRoute(pathname, item.href);
    if (item.external) {
      return (
        <a
          key={item.label}
          href={item.href}
          className={className}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackNavClick(item.label)}
        >
          {item.label}
        </a>
      );
    }
    return (
      <Link
        key={item.label}
        href={item.href}
        className={`${className} ${isActive ? styles.navLinkActive : ""}`}
        onClick={() => {
          trackNavClick(item.label);
          setMobileNavOpen(false);
        }}
      >
        {item.label}
      </Link>
    );
  }

  return (
    <>
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link
          href={ROUTES.home}
          className={styles.brand}
          onClick={() => trackNavClick("home")}
          aria-label="AlphBanX Mirror — home"
        >
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
        </Link>

        <nav className={styles.nav} aria-label="Main navigation">
          {NAV_ITEMS.map((item) => renderNavItem(item, styles.navLink))}
        </nav>

        <div className={styles.actions}>
          <div className={styles.network}>
            <span className={styles.networkDot} />
            Mainnet
          </div>
          <button
            type="button"
            className={styles.menuBtn}
            onClick={() => setMobileNavOpen((open) => !open)}
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-nav"
            aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
          >
            {mobileNavOpen ? "✕" : "☰"}
          </button>
          <button
            type="button"
            className={styles.donateBtn}
            onClick={() => setDonateOpen(true)}
            title="Support the dev"
          >
            ♥
          </button>
          <ConnectWalletButton />
        </div>
      </div>

      {mobileNavOpen && (
        <nav id="mobile-nav" className={styles.mobileNav} aria-label="Mobile navigation">
          {NAV_ITEMS.map((item) => renderNavItem(item, styles.mobileNavLink))}
        </nav>
      )}
    </header>

    {donateOpen && <DonationModal onClose={() => setDonateOpen(false)} />}
    </>
  );
}
