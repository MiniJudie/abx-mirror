import type { Metadata } from "next";
import { Suspense } from "react";
import { AlephiumProviders } from "@/components/AlephiumProviders";
import { MatomoAnalytics } from "@/components/MatomoAnalytics";
import "./globals.css";

export const metadata: Metadata = {
  title: "AlphBanx Mirror — Loan Explorer",
  description: "Community mirror for AlphBanx — decentralised banking on Alephium.",
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
