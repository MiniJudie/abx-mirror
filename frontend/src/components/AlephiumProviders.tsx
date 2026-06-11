"use client";

import { AlephiumWalletProvider } from "@alephium/web3-react";

export function AlephiumProviders({ children }: { children: React.ReactNode }) {
  return (
    <AlephiumWalletProvider network="mainnet" theme="simple-dark" csrModeOnly>
      {children}
    </AlephiumWalletProvider>
  );
}
