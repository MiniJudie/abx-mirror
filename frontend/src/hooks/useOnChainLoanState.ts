"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchLoanOnChainAmounts,
  type OnChainLoanAmounts,
} from "@/lib/loan-actions";

interface OnChainLoanState {
  amounts: OnChainLoanAmounts | null;
  loading: boolean;
  fetchedAt: Date | null;
  refresh: () => void;
}

export function useOnChainLoanState(
  loanAddress: string | undefined,
): OnChainLoanState {
  const [amounts, setAmounts] = useState<OnChainLoanAmounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!loanAddress) {
      setAmounts(null);
      setFetchedAt(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchLoanOnChainAmounts(loanAddress)
      .then((data) => {
        if (cancelled) return;
        setAmounts(data);
        setFetchedAt(new Date());
      })
      .catch(() => {
        if (cancelled) return;
        setAmounts(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loanAddress, tick]);

  return { amounts, loading, fetchedAt, refresh };
}
