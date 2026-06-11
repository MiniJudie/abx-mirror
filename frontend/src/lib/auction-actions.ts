"use client";

import {
  web3,
  NodeProvider,
  DUST_AMOUNT,
  ONE_ALPH,
  ALPH_TOKEN_ID,
  type SignerProvider,
} from "@alephium/web3";
import type { HexString } from "@alephium/web3";
import { AuctionManager } from "../../../artifacts/artifacts/ts/AuctionManager";
import { NewBid, NewBidder, CancelBid } from "../../../artifacts/artifacts/ts/scripts";
import {
  ABD_TOKEN_ID,
  ABD_DECIMALS,
  toAttoUnits,
  fromAttoUnits,
} from "./loan-actions";

export const AUCTION_MANAGER_ADDRESS =
  "29YL53teVrvK2o4P2cVej8aCGN7iQS8mE86bgxA2oFWa3";
export const AUCTION_MANAGER_CONTRACT_ID =
  "dca9e78ff1cc072053af4049ac256ceff313463684917b25088caeeb94f71200" as HexString;

const NODE_URL = "https://node.mainnet.alphscan.io";

let nodeProviderInitialized = false;
function ensureNodeProvider() {
  if (!nodeProviderInitialized) {
    web3.setCurrentNodeProvider(new NodeProvider(NODE_URL));
    nodeProviderInitialized = true;
  }
}

const auctionManager = AuctionManager.at(AUCTION_MANAGER_ADDRESS);

export async function getMinBid(): Promise<number> {
  ensureNodeProvider();
  const result = await auctionManager.view.getMinBid();
  return fromAttoUnits(result.returns as bigint, ABD_DECIMALS);
}

export async function hasBidder(walletAddress: string): Promise<boolean> {
  ensureNodeProvider();
  const bidderId = (
    await auctionManager.view.getBidderId({ args: { owner: walletAddress } })
  ).returns as HexString;
  return bidderId !== "";
}

export async function ensureBidderExists(
  signer: SignerProvider,
  walletAddress: string,
): Promise<void> {
  if (await hasBidder(walletAddress)) return;

  await NewBidder.execute({
    signer,
    initialFields: {
      auctionManager: AUCTION_MANAGER_CONTRACT_ID,
      bidder: walletAddress,
    },
    attoAlphAmount: DUST_AMOUNT,
  });
}

export async function createBidTx(
  signer: SignerProvider,
  discountPercent: number,
  abdAmount: number,
): Promise<string> {
  ensureNodeProvider();
  const attoAmount = toAttoUnits(abdAmount, ABD_DECIMALS);

  const result = await NewBid.execute({
    signer,
    initialFields: {
      auctionManager: AUCTION_MANAGER_CONTRACT_ID,
      discount: BigInt(discountPercent),
      abdAmount: attoAmount,
    },
    tokens: [
      { id: ABD_TOKEN_ID, amount: attoAmount },
      { id: ALPH_TOKEN_ID, amount: ONE_ALPH },
    ],
    attoAlphAmount: DUST_AMOUNT,
  });
  return result.txId;
}

export async function cancelBidTx(
  signer: SignerProvider,
  walletAddress: string,
  discountPercent: number,
  bidIndex: string,
): Promise<string> {
  ensureNodeProvider();

  const result = await CancelBid.execute({
    signer,
    initialFields: {
      auctionManager: AUCTION_MANAGER_CONTRACT_ID,
      bidIndex: BigInt(bidIndex),
      discount: BigInt(discountPercent),
      recipient: walletAddress,
    },
    attoAlphAmount: ONE_ALPH,
  });
  return result.txId;
}
