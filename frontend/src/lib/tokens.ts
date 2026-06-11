export const TOKEN_LIST_URL =
  "https://raw.githubusercontent.com/alephium/token-list/master/tokens/mainnet.json";

export interface TokenMeta {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  description?: string;
}

interface TokenListResponse {
  networkId: number;
  tokens: TokenMeta[];
}

let tokenCache: Map<string, TokenMeta> | null = null;
let tokenLoadPromise: Promise<Map<string, TokenMeta>> | null = null;

function indexTokens(tokens: TokenMeta[]): Map<string, TokenMeta> {
  const map = new Map<string, TokenMeta>();
  for (const token of tokens) {
    map.set(token.symbol.toUpperCase(), token);
    map.set(token.id.toLowerCase(), token);
  }
  return map;
}

export async function loadTokenList(): Promise<Map<string, TokenMeta>> {
  if (tokenCache) return tokenCache;
  if (!tokenLoadPromise) {
    tokenLoadPromise = fetch(TOKEN_LIST_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Token list fetch failed (${res.status})`);
        return res.json() as Promise<TokenListResponse>;
      })
      .then((data) => {
        tokenCache = indexTokens(data.tokens);
        return tokenCache;
      })
      .catch((err) => {
        tokenLoadPromise = null;
        throw err;
      });
  }
  return tokenLoadPromise;
}

export function getTokenBySymbol(
  tokens: Map<string, TokenMeta> | null,
  symbol: string,
): TokenMeta | undefined {
  return tokens?.get(symbol.toUpperCase());
}
