import Image from "next/image";
import styles from "./Hero.module.css";

const FEATURES = [
  {
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M8 1L2 4V7.5C2 10.5 4.5 13.2 8 14C11.5 13.2 14 10.5 14 7.5V4L8 1Z"
          stroke="currentColor"
          strokeWidth="1.2"
        />
      </svg>
    ),
    title: "Non-custodial",
    desc: "Your keys, your assets. Always.",
  },
  {
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="11" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M1 13C1 10.5 3.2 9 6 9C8.8 9 11 10.5 11 13" stroke="currentColor" strokeWidth="1.2" />
        <path d="M11 9C13.3 9 15 10.3 15 12.5V13" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
    title: "Community Run",
    desc: "Built and maintained by the ecosystem.",
  },
  {
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M8 2L14 13H2L8 2Z" stroke="currentColor" strokeWidth="1.2" />
        <path d="M8 6V9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
      </svg>
    ),
    title: "Use Carefully",
    desc: "Verify everything you sign.",
  },
];

export function Hero() {
  return (
    <section className={styles.hero}>
      <div className={styles.inner}>
        <div className={styles.content}>
          <h1 className={styles.title}>
            Borrow. Lend.
          </h1>
          <p className={styles.description}>
            AlphBanX is a decentralised lending protocol on Alephium. Supply collateral,
            borrow ABD, and manage your positions.
          </p>

          <div className={styles.features}>
            {FEATURES.map((f) => (
              <div key={f.title} className={styles.feature}>
                <span className={styles.featureIcon}>{f.icon}</span>
                <div>
                  <span className={styles.featureTitle}>{f.title}</span>
                  <span className={styles.featureDesc}>{f.desc}</span>
                </div>
              </div>
            ))}
          </div>

          <div className={styles.warning}>
            <span className={styles.warningIcon}>⚠</span>
            <div>
              <strong>Community-hosted mirror interface.</strong>
              <span className={styles.warningSub}>
                {" "}This is not the official AlphBanX app. Data is indexed from Alephium
                mainnet. Always verify contract addresses before signing transactions.
              </span>
            </div>
          </div>
        </div>

        <div className={styles.visual}>
          <Image
            src="/assets/header.png"
            alt="AlphBanX mirror"
            width={560}
            height={400}
            className={styles.headerImage}
            priority
          />
        </div>
      </div>
    </section>
  );
}
