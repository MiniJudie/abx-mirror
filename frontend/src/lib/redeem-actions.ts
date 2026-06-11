"use client";

import {
  web3,
  NodeProvider,
  addressFromContractId,
  type HexString,
  type SignerProvider,
} from "@alephium/web3";
import { BorrowerOperationsV2 } from "../../../artifacts/artifacts/ts/BorrowerOperationsV2";
import { LoanManagerV2 } from "../../../artifacts/artifacts/ts/LoanManagerV2";
import { SortedList } from "../../../artifacts/artifacts/ts/SortedList";
import { RedeemV2 } from "../../../artifacts/artifacts/ts/scripts";
import {
  ABD_TOKEN_ID,
  BORROWER_OPS_ADDRESS,
  ABD_DECIMALS,
  ALPH_DECIMALS,
  toAttoUnits,
} from "./loan-actions";

const NODE_URL = "https://node.mainnet.alphscan.io";

// LoanManagerV2 deployed address — holds the SortedList reference
const LOAN_MANAGER_ADDRESS = "tpxjsWJSaUh5i7XzNAsTWMRtD9QvDTV9zmMNeHHS6jQB";

let _initialized = false;
function ensureNodeProvider() {
  if (!_initialized) {
    web3.setCurrentNodeProvider(new NodeProvider(NODE_URL));
    _initialized = true;
  }
}

export { ABD_DECIMALS, ALPH_DECIMALS, toAttoUnits };

/**
 * Returns the contract ID of the first (lowest-CR) loan in the sorted list.
 * Passing this as `lastRedeemedLoanPositionHintId` lets the contract jump
 * directly to the correct starting position instead of scanning all 196 list
 * nodes — the O(n) traversal is what causes OutOfGas for non-trivial amounts.
 * Falls back to "" (empty hint) if the list is empty.
 */
async function getFirstLoanPositionHintId(): Promise<HexString> {
  const lm = LoanManagerV2.at(LOAN_MANAGER_ADDRESS);
  const { returns: listId } = await lm.view.getLoansListId();
  const listAddr = addressFromContractId(listId as HexString);
  const sl = SortedList.at(listAddr);
  const { returns: isEmpty } = await sl.view.isEmpty();
  if (isEmpty) return "" as HexString;
  const { returns: first } = await sl.view.getFirst();
  return first as HexString;
}

export interface RedeemParams {
  signer: SignerProvider;
  walletAddress: string;
  /** ABD amount in display units (e.g. 100.5) */
  abdAmount: number;
  /** Max number of loans to redeem against (default 100) */
  loansLimit?: number;
}

/**
 * Redeems ABD for ALPH at the oracle price using the RedeemV2 TxScript,
 * mirroring exactly how the original AlphBanX app performs redemptions.
 *
 * Key invariants:
 * - minAlphWithdrawal = 0n: non-zero values cause the contract to loop
 *   searching for sufficient collateral, exhausting gas.
 * - no explicit gasAmount: node auto-estimates with max gas then charges only
 *   what was consumed. An explicit cap (e.g. 500k) is too low for >1 loan.
 * - lastRedeemedLoanPositionHintId: fetched live so the contract starts at
 *   the first active loan rather than traversing the full 196-entry list.
 */
export async function redeemAbd(params: RedeemParams): Promise<string> {
  const { signer, walletAddress, abdAmount, loansLimit = 100 } = params;
  ensureNodeProvider();

  const attoAbd = toAttoUnits(abdAmount, ABD_DECIMALS);
  const borrowerOps = BorrowerOperationsV2.at(BORROWER_OPS_ADDRESS);
  const hintId = await getFirstLoanPositionHintId();

  const result = await RedeemV2.execute({
    signer,
    initialFields: {
      operations: borrowerOps.contractId as HexString,
      abdAmount: attoAbd,
      recipient: walletAddress,
      loansLimit: BigInt(loansLimit),
      minAlphWithdrawal: BigInt(0),
      lastRedeemedLoanPositionHintId: hintId,
    },
    tokens: [{ id: ABD_TOKEN_ID, amount: attoAbd }],
  });

  return result.txId;
}
