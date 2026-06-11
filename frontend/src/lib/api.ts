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

export interface AuctionBid {
  bidAddress: string;
  bidderContractAddress: string;
  bidderWallet: string;
  abdAmount: string;
  createdAt: string;
}

export interface AuctionPool {
  discount: string;
  discountPercent: number;
  totalAbdAmount: string;
  bidCount: number;
  bids: AuctionBid[];
}

export interface BidderStat {
  wallet: string;
  abdTotal: string;
  percent: number;
}

export interface BidderSummary {
  openCount: number;
  filledCount: number;
  canceledCount: number;
}

export interface UserBidPosition {
  bidAddress: string;
  discountPercent: number;
  abdAmount: string;
  bidStatus: "open" | "completed" | "canceled";
  bidIndex?: string;
  recordedAt: string;
}

export interface UserAuctionPositionsResponse {
  positions: UserBidPosition[];
  total: number;
}

export interface AuctionsResponse {
  pools: AuctionPool[];
  bidderSummary: BidderSummary;
}

export interface LiquidationEvent {
  txId: string;
  loan: string;
  loanOwner: string;
  newCollateral: string;
  newDebt: string;
  timestamp: number;
  recordedAt: string;
  auctionOwner?: string;
  abdLiquidated?: string;
  alphReward?: string;
  discount?: number;
  liquidator?: string;
}

export interface LiquidationsResponse {
  liquidations: LiquidationEvent[];
  total: number;
}

export interface StakingPosition {
  stakerContract: string;
  ownerAddress: string;
  stakedAbx: string;
  lockedAbx: string;
  withdrawableAbx: string;
  withdrawableAfterUnlockAbx: string;
  nextUnlockAt: string | null;
  lockCount: number;
  status: "active" | "vesting" | "withdrawable";
  /** ALPH balance of the Staker contract minus storage deposit (cached by watcher). */
  claimableAlph: string;
  /** Cumulative lifetime ALPH earned from statistics.totalRewarded (cached by watcher). */
  totalEarnedAlph: string;
  lastUpdated: string;
}

export interface StakingSummary {
  totalStakers: number;
  totalStakedAbx: string;
  totalLockedAbx: string;
  totalWithdrawableAbx: string;
  updatedAt?: string;
}

export interface StakersResponse {
  stakers: StakingPosition[];
  total: number;
  summary: StakingSummary | null;
}

export interface UserStakingPositionsResponse {
  positions: StakingPosition[];
}

export interface DexPoolSnapshot {
  symbol: string;
  poolAddress: string;
  reserve: string;
}

export interface TreasuryAddrSnapshot {
  addr: string;
  amount: string;
}

export interface TokenStatsResponse {
  pk: string;
  // ABX
  abxTotalSupply: string;
  abxInStaking: string;
  abxInDex: string;
  abxInDexPools: DexPoolSnapshot[];
  abxTreasury: string;
  abxTreasuryAddrs?: TreasuryAddrSnapshot[];
  // ABD
  abdTotalSupply: string;
  abdInAuctionPools: string;
  abdInDex: string;
  abdInDexPools: DexPoolSnapshot[];
  abdTreasury: string;
  abdTreasuryAddrs?: TreasuryAddrSnapshot[];
  updatedAt: string;
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

export async function fetchAuctions(): Promise<AuctionsResponse> {
  const res = await fetch(`${getApiUrl()}/auctions`);
  if (!res.ok) {
    throw new Error(`Failed to fetch auctions: ${res.status}`);
  }
  return res.json();
}

export async function fetchUserAuctionPositions(
  wallet: string,
): Promise<UserAuctionPositionsResponse> {
  const res = await fetch(
    `${getApiUrl()}/auctions/positions/${encodeURIComponent(wallet)}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch auction positions: ${res.status}`);
  }
  return res.json();
}

export async function fetchAuctionBidders(
  status: "open" | "filled" | "canceled",
): Promise<BidderStat[]> {
  const res = await fetch(
    `${getApiUrl()}/auctions/bidders?status=${encodeURIComponent(status)}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch bidders (${status}): ${res.status}`);
  }
  const data = await res.json();
  return data.bidders as BidderStat[];
}

export async function indexLoan(owner: string): Promise<void> {
  await fetch(`${getApiUrl()}/loans/index`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner }),
  });
}

export async function fetchAuctionPoolBids(discount: string): Promise<AuctionBid[]> {
  const res = await fetch(
    `${getApiUrl()}/auctions/${encodeURIComponent(discount)}/bids`,
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch bids for pool ${discount}: ${res.status}`);
  }
  const data = await res.json();
  return data.bids as AuctionBid[];
}

export async function fetchLiquidations(): Promise<LiquidationsResponse> {
  const res = await fetch(`${getApiUrl()}/liquidations`);
  if (!res.ok) {
    throw new Error(`Failed to fetch liquidations: ${res.status}`);
  }
  return res.json();
}

export async function fetchStakers(): Promise<StakersResponse> {
  const res = await fetch(`${getApiUrl()}/stakers`);
  if (!res.ok) {
    throw new Error(`Failed to fetch stakers: ${res.status}`);
  }
  return res.json();
}

export async function fetchStakerByOwner(
  wallet: string,
): Promise<UserStakingPositionsResponse> {
  const res = await fetch(
    `${getApiUrl()}/stakers/by-owner/${encodeURIComponent(wallet)}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch staking positions: ${res.status}`);
  }
  return res.json();
}

export async function fetchTokenStats(): Promise<TokenStatsResponse> {
  const res = await fetch(`${getApiUrl()}/token-stats`);
  if (!res.ok) {
    throw new Error(`Failed to fetch token stats: ${res.status}`);
  }
  return res.json();
}

/**
 * Asks the API to re-fetch the given wallet's staking position live from the
 * chain and persist it to DynamoDB. Returns the fresh position so the UI can
 * update immediately without a separate chain call.
 */
export async function reindexStakerPosition(
  wallet: string,
): Promise<StakingPosition | null> {
  try {
    const res = await fetch(`${getApiUrl()}/stakers/reindex`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.position as StakingPosition) ?? null;
  } catch {
    return null;
  }
}
