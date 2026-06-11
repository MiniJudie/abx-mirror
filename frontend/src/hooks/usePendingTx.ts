"use client";

import { useEffect, useRef, useState } from "react";
import { web3 } from "@alephium/web3";

const POLL_INTERVAL_MS = 4_000;

export type PendingTxStatus = "pending" | "confirmed" | "failed";

export function usePendingTx(
  txId: string | null,
  onConfirmed: () => void,
): { status: PendingTxStatus } {
  const [status, setStatus] = useState<PendingTxStatus>("pending");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  useEffect(() => {
    if (!txId) return;
    setStatus("pending");

    const check = async () => {
      try {
        const s = await web3
          .getCurrentNodeProvider()
          .transactions.getTransactionsStatus({ txId });
        if (s.type === "Confirmed") {
          setStatus("confirmed");
          if (timerRef.current) clearInterval(timerRef.current);
          onConfirmedRef.current();
        }
      } catch {
        // keep polling; node may be temporarily unreachable
      }
    };

    check();
    timerRef.current = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [txId]);

  return { status };
}
