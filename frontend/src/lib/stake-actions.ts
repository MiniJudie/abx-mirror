"use client";

import { web3, NodeProvider, ONE_ALPH, type HexString, type SignerProvider } from "@alephium/web3";
import { Staker } from "../../../artifacts/artifacts/ts/Staker";
import {
  StakeV2,
  UnstakeV2,
  WithdrawRewardV2,
  WithdrawStakeV2,
} from "../../../artifacts/artifacts/ts/scripts";

/** Max lock-info contracts processed per unlock transaction (protocol default). */
const MAX_UNLOCKS_PER_TX = BigInt(100);

export const STAKE_MANAGER_ADDRESS =
  "28Mhs2tczfKJDUq7seTzaRctZXUhqkMzikrehxAHy2kVu";
export const STAKE_MANAGER_CONTRACT_ID =
  "cb15784c91a7c8cc0c073e77a9ea2c4e8eec5782c27d5e47febb3e6c9439fb00" as HexString;
export const ABX_TOKEN_ID =
  "9b3070a93fd5127d8c39561870432fdbc79f598ca8dbf2a3398fc100dfd45f00" as HexString;
export const ABX_DECIMALS = 9;
export const ALPH_DECIMALS = 18;

const NODE_URL = "https://node.mainnet.alphscan.io";


let _initialized = false;
function ensureNodeProvider() {
  if (!_initialized) {
    web3.setCurrentNodeProvider(new NodeProvider(NODE_URL));
    _initialized = true;
  }
}

export function toAttoAbx(amount: number): bigint {
  return BigInt(Math.floor(amount * 10 ** ABX_DECIMALS));
}

export function fromAttoAbx(raw: bigint): number {
  return Number(raw) / 10 ** ABX_DECIMALS;
}

export function fromAttoAlph(raw: bigint): number {
  return Number(raw) / 10 ** ALPH_DECIMALS;
}

export function toAttoAlph(amount: number): bigint {
  return BigInt(Math.floor(amount * 10 ** ALPH_DECIMALS));
}

/** Returns the wallet's ABX token balance in display units (not atto). */
export async function fetchWalletAbxBalance(walletAddress: string): Promise<number> {
  ensureNodeProvider();
  const node = new NodeProvider(NODE_URL);
  const result = await node.addresses.getAddressesAddressBalance(walletAddress);
  const found = (result.tokenBalances ?? []).find((t) => t.id === ABX_TOKEN_ID);
  return found ? fromAttoAbx(BigInt(found.amount)) : 0;
}

export interface StakerRevenue {
  /** ALPH currently sitting in the Staker contract, ready to withdraw. */
  claimableAlph: number;
  /** Cumulative ALPH ever earned by this position (lifetime). */
  totalEarnedAlph: number;
  /** Lifetime ALPH earned per 1 ABX staked. */
  earnedPerAbx: number;
}

/**
 * Fetches reward data for a specific Staker sub-contract:
 * - claimable ALPH (contract balance minus storage floor)
 * - lifetime ALPH earned (from statistics.totalRewarded)
 * - normalised yield per ABX
 */
export async function fetchStakerRevenue(
  stakerContractAddr: string,
  stakedAbxDisplay: string,
): Promise<StakerRevenue> {
  ensureNodeProvider();
  const staker = Staker.at(stakerContractAddr);

  const [claimableAtto, statsResult] = await Promise.all([
    staker.view.getReward().then((r) => r.returns as bigint),
    staker.view.getStatistics(),
  ]);

  const totalEarnedAtto = (
    statsResult.returns as { totalRewarded: bigint }
  ).totalRewarded;

  const claimableAlph = fromAttoAlph(claimableAtto);
  const totalEarnedAlph = fromAttoAlph(totalEarnedAtto);
  const stakedAbxNum = parseFloat(stakedAbxDisplay) || 0;
  const earnedPerAbx = stakedAbxNum > 0 ? totalEarnedAlph / stakedAbxNum : 0;

  return { claimableAlph, totalEarnedAlph, earnedPerAbx };
}

/** Polls the node for a transaction's status. Returns the discriminant type string. */
export async function pollTxStatus(txId: string): Promise<string> {
  const node = new NodeProvider(NODE_URL);
  const result = await node.transactions.getTransactionsStatus({ txId });
  return result.type;
}

/** Executes a StakeV2 transaction and returns the transaction ID. */
export async function stakeAbx(
  signer: SignerProvider,
  amountAbx: number,
): Promise<string> {
  ensureNodeProvider();
  const attoAmount = toAttoAbx(amountAbx);

  const result = await StakeV2.execute({
    signer,
    initialFields: {
      stakeManager: STAKE_MANAGER_CONTRACT_ID,
      amount: attoAmount,
    },
    tokens: [{ id: ABX_TOKEN_ID, amount: attoAmount }],
    // 1 ALPH covers the Staker sub-contract storage deposit on first stake;
    // any excess is automatically returned to the caller.
    attoAlphAmount: ONE_ALPH,
  });

  return result.txId;
}

/** Executes an UnstakeV2 transaction (begins vesting) and returns the transaction ID. */
export async function unstakeAbx(
  signer: SignerProvider,
  amountAbx: number,
): Promise<string> {
  ensureNodeProvider();
  const attoAmount = toAttoAbx(amountAbx);

  const result = await UnstakeV2.execute({
    signer,
    initialFields: {
      stakeManager: STAKE_MANAGER_CONTRACT_ID,
      amount: attoAmount,
    },
    // LockInfo sub-contract creation requires contract storage deposit;
    // any excess is returned to the caller.
    attoAlphAmount: ONE_ALPH,
  });

  return result.txId;
}

/** Claims accrued ALPH rewards from the stake manager to the wallet. */
export async function claimStakerAlph(
  signer: SignerProvider,
  walletAddress: string,
  claimableAlph: number,
): Promise<string> {
  ensureNodeProvider();
  const maxAmount = toAttoAlph(claimableAlph);
  if (maxAmount <= BigInt(0)) {
    throw new Error("No claimable ALPH rewards.");
  }

  const result = await WithdrawRewardV2.execute({
    signer,
    initialFields: {
      stakeManager: STAKE_MANAGER_CONTRACT_ID,
      maxAmount,
      recipient: walletAddress,
    },
    attoAlphAmount: ONE_ALPH,
  });

  return result.txId;
}

export interface StakerWithdrawableAmounts {
  withdrawable: bigint;
  afterUnlock: bigint;
}

/** Live withdrawable ABX in the Staker contract (atto units). */
export async function fetchStakerWithdrawableAmounts(
  stakerContractAddr: string,
): Promise<StakerWithdrawableAmounts> {
  ensureNodeProvider();
  const staker = Staker.at(stakerContractAddr);
  const [withdrawable, afterUnlock] = await Promise.all([
    staker.view.getWithdrawableAmount().then((r) => r.returns as bigint),
    staker.view.getWithdrawableAfterUnlock().then((r) => r.returns as bigint),
  ]);
  return { withdrawable, afterUnlock };
}

/**
 * Unlocks matured vesting locks (if any) and withdraws all available ABX to the wallet.
 * Mirrors AlphBanx's WithdrawStakeV2 script — UnlockStake alone does not send ABX back.
 */
export async function claimVestingAbx(
  signer: SignerProvider,
  walletAddress: string,
  stakerContractAddr: string,
): Promise<string> {
  ensureNodeProvider();
  const { withdrawable, afterUnlock } =
    await fetchStakerWithdrawableAmounts(stakerContractAddr);
  const maxAmount = withdrawable + afterUnlock;
  if (maxAmount <= BigInt(0)) {
    throw new Error("No withdrawable ABX to claim.");
  }

  const result = await WithdrawStakeV2.execute({
    signer,
    initialFields: {
      stakeManager: STAKE_MANAGER_CONTRACT_ID,
      maxAmount,
      recipient: walletAddress,
      maxUnlockAmount: MAX_UNLOCKS_PER_TX,
    },
    attoAlphAmount: ONE_ALPH,
  });

  return result.txId;
}
