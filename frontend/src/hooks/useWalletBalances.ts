"use client";

import { useCallback, useEffect, useState } from "react";
import { NodeProvider } from "@alephium/web3";
import { ABD_TOKEN_ID, ABD_DECIMALS, fromAttoUnits } from "@/lib/loan-actions";

const NODE_URL = "https://node.mainnet.alphscan.io";

interface WalletBalances {
  alphBalance: number | null;
  abdBalance: number | null;
  loading: boolean;
  refresh: () => void;
}

export function useWalletBalances(address: string | undefined): WalletBalances {
  const [alphBalance, setAlphBalance] = useState<number | null>(null);
  const [abdBalance, setAbdBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!address) {
      setAlphBalance(null);
      setAbdBalance(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const provider = new NodeProvider(NODE_URL);
    provider.addresses
      .getAddressesAddressBalance(address)
      .then((res) => {
        if (cancelled) return;
        setAlphBalance(fromAttoUnits(BigInt(res.balance)));
        const abdEntry = (res.tokenBalances ?? []).find(
          (t: { id: string; amount: string }) => t.id === ABD_TOKEN_ID,
        );
        setAbdBalance(abdEntry ? fromAttoUnits(BigInt(abdEntry.amount), ABD_DECIMALS) : 0);
      })
      .catch(() => {
        if (cancelled) return;
        setAlphBalance(null);
        setAbdBalance(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, tick]);

  return { alphBalance, abdBalance, loading, refresh };
}
