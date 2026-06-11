"use client";

import { useEffect, useState } from "react";
import { getTokenBySymbol, loadTokenList, type TokenMeta } from "@/lib/tokens";

export function useTokenList() {
  const [tokens, setTokens] = useState<Map<string, TokenMeta> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTokenList()
      .then(setTokens)
      .catch((err) => setError((err as Error).message));
  }, []);

  return {
    tokens,
    loading: !tokens && !error,
    error,
    getToken: (symbol: string) => getTokenBySymbol(tokens, symbol),
  };
}
