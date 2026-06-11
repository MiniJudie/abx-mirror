"use client";

import {
  web3,
  NodeProvider,
  DUST_AMOUNT,
  addressFromContractId,
  type SignerProvider,
} from "@alephium/web3";
import type { HexString } from "@alephium/web3";
import { BorrowerOperationsV2 } from "../../../artifacts/artifacts/ts/BorrowerOperationsV2";
import { LoanManagerV2 } from "../../../artifacts/artifacts/ts/LoanManagerV2";
import { Loan } from "../../../artifacts/artifacts/ts/Loan";
import { ListNode } from "../../../artifacts/artifacts/ts/ListNode";
import { SortedList } from "../../../artifacts/artifacts/ts/SortedList";
export const ABD_TOKEN_ID =
  "c7d1dab489ee40ca4e6554efc64a64e73a9f0ddfdec9e544c82c1c6742ccc500";
export const BORROWER_OPS_ADDRESS =
  "28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF";
/** ContractId of BorrowerOperationsV2 — extracted from AlphBanx signed bytecode. */
export const BORROWER_OPS_V2_CONTRACT_ID =
  "5c22a28b0e6ad73521ce47e3741ae5a00259fb5f266af79c11a7083c31cf6679" as const;
export const LOAN_MANAGER_ADDRESS =
  "tpxjsWJSaUh5i7XzNAsTWMRtD9QvDTV9zmMNeHHS6jQB";

export const GAS_RESERVE_ALPH = 0.1;
export const ALPH_DECIMALS = 18;
export const ABD_DECIMALS = 9;
const NODE_URL = "https://node.mainnet.alphscan.io";

let nodeProviderInitialized = false;
function ensureNodeProvider() {
  if (!nodeProviderInitialized) {
    web3.setCurrentNodeProvider(new NodeProvider(NODE_URL));
    nodeProviderInitialized = true;
  }
}

export function toAttoUnits(amount: number, decimals = 18): bigint {
  const factor = 10 ** decimals;
  return BigInt(Math.round(amount * factor));
}

export function fromAttoUnits(amount: bigint | string, decimals = 18): number {
  return Number(BigInt(amount)) / 10 ** decimals;
}

const EMPTY_HINT: HexString = "" as HexString;
const ONE_E18 = BigInt("1000000000000000000");
const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);

const borrowerOps = BorrowerOperationsV2.at(BORROWER_OPS_ADDRESS);
const loanManager = LoanManagerV2.at(LOAN_MANAGER_ADDRESS);

/**
 * Returns the list of valid interest rates (as human-readable numbers, e.g. 5 for 5%)
 * that the LoanManager accepts, fetched live from the chain.
 */
export async function getAvailableInterestRates(): Promise<number[]> {
  ensureNodeProvider();
  const result = await loanManager.view.getAllInterestRates();
  return (result.returns as bigint[]).filter((r) => r > BigInt(0)).map(Number);
}

/**
 * Walks the loan sorted list to find the correct insertion position hint for
 * a borrow/interest-rate-update operation. This matches AlphBanx's `b()` function.
 *
 * Returns the ID of the list node BEFORE the insertion point (empty = insert at head).
 * `skipLoanId` is the user's own loan ID (skipped during traversal since it will be moved).
 */
/**
 * Computes the minting fee in atto-ALPH for display purposes.
 * (The fee itself is taken from collateral on-chain, NOT from the tx's attoAlphAmount.)
 */
export async function getMintingFeeAtto(collateralAtto: bigint): Promise<bigint> {
  ensureNodeProvider();
  const feePercent = (await loanManager.view.getMintingFeePercent()).returns;
  return (collateralAtto * feePercent) / ONE_E18;
}

async function getPositionHintId(
  newInterestRate: bigint,
  newCR: bigint,
  collateral: bigint,
  skipLoanId: HexString,
): Promise<HexString> {

  const compare = (
    a: { ir: bigint; ncr: bigint; coll: bigint },
    b: { ir: bigint; ncr: bigint; coll: bigint },
  ): number => {
    if (a.ir > b.ir) return 1;
    if (a.ir < b.ir) return -1;
    if (a.ncr === MAX_UINT256 && b.ncr === MAX_UINT256)
      return a.coll > b.coll ? 1 : a.coll < b.coll ? -1 : 0;
    return a.ncr > b.ncr ? 1 : a.ncr < b.ncr ? -1 : 0;
  };

  const newLoan = { ir: newInterestRate, ncr: newCR, coll: collateral };

  const listId = (await loanManager.view.getLoansListId()).returns;
  const sortedList = SortedList.at(addressFromContractId(listId));
  let currentNodeId: HexString = (await sortedList.view.getFirst()).returns;

  let hintId: HexString = "" as HexString;
  let iterations = 0;

  while (currentNodeId !== "" && iterations < 500) {
    const listNode = ListNode.at(addressFromContractId(currentNodeId));
    const loanId = (await listNode.view.getContractId()).returns;

    if (loanId === skipLoanId) {
      currentNodeId = (await listNode.view.getNextId()).returns;
      continue;
    }

    try {
      const loanState = await Loan.at(addressFromContractId(loanId)).fetchState();
      const { interestRate, collateral: coll, debt } = loanState.fields;
      const ncr = debt > BigInt(0) ? (coll * ONE_E18) / debt : MAX_UINT256;
      const existing = { ir: interestRate, ncr, coll };

      if (compare(newLoan, existing) >= 0) {
        hintId = currentNodeId;
      } else {
        break;
      }
    } catch {
      // skip inaccessible loans
    }

    currentNodeId = (await listNode.view.getNextId()).returns;
    iterations++;
  }

  return hintId;
}

export async function addCollateralTx(
  signer: SignerProvider,
  alphAmount: number,
): Promise<string> {
  ensureNodeProvider();
  const attoAmount = toAttoUnits(alphAmount);
  const result = await borrowerOps.transact.addCollateral({
    signer,
    args: { alphAmount: attoAmount, positionHintId: EMPTY_HINT },
    attoAlphAmount: attoAmount,
  });
  return result.txId;
}

export async function withdrawCollateralTx(
  signer: SignerProvider,
  recipient: string,
  alphAmount: number,
): Promise<string> {
  ensureNodeProvider();
  const attoAmount = toAttoUnits(alphAmount);
  const result = await borrowerOps.transact.withdrawCollateral({
    signer,
    args: {
      alphAmount: attoAmount,
      recipient,
      positionHintId: EMPTY_HINT,
    },
  });
  return result.txId;
}

/**
 * Borrow ABD by updating interest rate — mirrors AlphBanx's `kl` function exactly.
 *
 * Key details (sourced from the AlphBanx unminified bundle):
 *   - `recipient` = the user's own wallet address (ABD is minted to them)
 *   - `attoAlphAmount` = 2 × DUST_AMOUNT (~0.0002 ALPH); the minting fee is taken
 *     from the loan's collateral on-chain, not from the tx ALPH amount
 *   - `positionHintId` is computed by walking the sorted loan list so the contract
 *     can efficiently find the correct insertion point for the updated loan
 */
export async function borrowAbdTx(
  signer: SignerProvider,
  walletAddress: string,
  abdAmount: number,
  interestRate: number,
  collateral: number,
  currentDebt: number,
): Promise<string> {
  ensureNodeProvider();

  const attoAmount = toAttoUnits(abdAmount, ABD_DECIMALS);
  console.log("[borrowAbdTx] abdAmount (human):", abdAmount, "| attoAmount (bigint):", attoAmount.toString());
  const collateralAtto = toAttoUnits(collateral);
  const newDebtAtto = toAttoUnits(currentDebt, ABD_DECIMALS) + attoAmount;
  const newCR =
    newDebtAtto > BigInt(0) ? (collateralAtto * ONE_E18) / newDebtAtto : MAX_UINT256;

  // Get the user's current loan ID so we can skip it during list traversal
  const loanId = (
    await loanManager.view.getLoanId({ args: { owner: walletAddress } })
  ).returns;

  const positionHintId = await getPositionHintId(
    BigInt(interestRate),
    newCR,
    collateralAtto,
    loanId,
  );

  const txAttoAlph = BigInt(2) * DUST_AMOUNT + toAttoUnits(GAS_RESERVE_ALPH);
  console.log("[borrowAbdTx] transact args:", {
    newInterestRate: BigInt(interestRate).toString(),
    abdAmount: attoAmount.toString(),
    recipient: walletAddress,
    positionHintId,
    attoAlphAmount: txAttoAlph.toString(),
  });

  const result = await borrowerOps.transact.updateInterestRateAndBorrowAbd({
    signer,
    args: {
      newInterestRate: BigInt(interestRate),
      abdAmount: attoAmount,
      recipient: walletAddress,
      positionHintId,
    },
    // 0.1 ALPH covers gas + any ALPH consumed internally; unused is returned to sender.
    attoAlphAmount: txAttoAlph,
  });
  return result.txId;
}

/**
 * For 0% interest-rate loans, BorrowerOperationsV2 enforces a per-wallet borrow cap
 * based on how much ABX the user has staked (zero-fee tier system).
 * Returns the remaining amount the wallet can borrow at 0%, in ABD (human units),
 * already accounting for currentDebt so the caller just uses it directly as a max.
 */
export async function getUserZeroFeeRemainingDebt(
  walletAddress: string,
  currentDebtAtto: bigint,
): Promise<number> {
  ensureNodeProvider();
  const stakeRes = await borrowerOps.view.getStakedAmount({ args: { owner: walletAddress } });
  const maxDebtRes = await borrowerOps.view.getZeroFeeMaxDebt({ args: { stakeAmount: stakeRes.returns } });
  const remaining = maxDebtRes.returns > currentDebtAtto
    ? maxDebtRes.returns - currentDebtAtto
    : BigInt(0);
  return fromAttoUnits(remaining, ABD_DECIMALS);
}

export async function repayAbdTx(
  signer: SignerProvider,
  abdAmount: number,
): Promise<string> {
  ensureNodeProvider();
  const attoAmount = toAttoUnits(abdAmount, ABD_DECIMALS);
  const result = await borrowerOps.transact.repayAbd({
    signer,
    args: { abdAmount: attoAmount, positionHintId: EMPTY_HINT },
    tokens: [{ id: ABD_TOKEN_ID, amount: attoAmount }],
    attoAlphAmount: DUST_AMOUNT,
  });
  return result.txId;
}
