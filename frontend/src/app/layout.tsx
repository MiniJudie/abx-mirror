import type { Metadata } from "next";
import { Suspense } from "react";
import { AlephiumProviders } from "@/components/AlephiumProviders";
import { MatomoAnalytics } from "@/components/MatomoAnalytics";
import "./globals.css";

const BASE_URL = "https://abx.alephium-mirrors.com";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "AlphBanX Mirror — Loan Explorer",
    template: "%s · AlphBanX Mirror",
  },
  description:
    "Community-run mirror interface for the AlphBanX lending protocol on Alephium. Track loans, auctions, staking, and token distribution. Open source.",
  keywords: ["AlphBanX", "Alephium", "DeFi", "lending", "stablecoin", "ABD", "ABX", "ALPH", "mirror"],
  authors: [{ name: "AlphBanX Mirror", url: "https://github.com/MiniJudie/abx-mirror" }],
  creator: "AlphBanX Mirror Community",
  openGraph: {
    type: "website",
    url: BASE_URL,
    siteName: "AlphBanX Mirror",
    title: "AlphBanX Mirror — Loan Explorer",
    description:
      "Community-run mirror interface for the AlphBanX lending protocol on Alephium. Track loans, auctions, staking, and token distribution.",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 800,
        alt: "AlphBanX Mirror — Decentralised Lending on Alephium",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AlphBanX Mirror — Loan Explorer",
    description:
      "Community-run mirror interface for the AlphBanX lending protocol on Alephium.",
    images: ["/og-image.jpg"],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AlephiumProviders>{children}</AlephiumProviders>
        <Suspense fallback={null}>
          <MatomoAnalytics />
        </Suspense>
      </body>
    </html>
  );
}
