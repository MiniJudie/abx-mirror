export interface Loan {
  loanAddress: string;
  owner: string;
  collateral: string;
  debt: string;
  interestRate: string;
  crZone: "Active" | "Risky" | "Auction" | "Undercollateralized";
  lastUpdated: string;
}

export interface LoansResponse {
  loans: Loan[];
  total: number;
}

export interface OraclePrice {
  abdUsd: string;
  alphUsd: string;
  recordedAt?: string;
  source?: string;
}

function getApiUrl(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) {
    throw new Error("NEXT_PUBLIC_API_URL is not set");
  }
  return apiUrl;
}

export async function fetchLoans(): Promise<LoansResponse> {
  const res = await fetch(`${getApiUrl()}/loans`);
  if (!res.ok) {
    throw new Error(`Failed to fetch loans: ${res.status}`);
  }
  return res.json();
}

export async function fetchOraclePrice(): Promise<OraclePrice> {
  const res = await fetch(`${getApiUrl()}/price`);
  if (!res.ok) {
    throw new Error(`Failed to fetch oracle price: ${res.status}`);
  }
  return res.json();
}

export async function fetchLoanByOwner(address: string): Promise<Loan | null> {
  const res = await fetch(
    `${getApiUrl()}/loans/by-owner/${encodeURIComponent(address)}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to fetch loan for owner: ${res.status}`);
  }
  return res.json();
}
