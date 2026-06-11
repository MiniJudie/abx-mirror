import { AuctionManager } from "../../../artifacts/artifacts/ts/AuctionManager";
import { BorrowerOperationsV2 } from "../../../artifacts/artifacts/ts/BorrowerOperationsV2";
import { LoanManager } from "../../../artifacts/artifacts/ts/LoanManager";
import mainnetDeployments from "../../contracts/deployments.mainnet.json";

export function loadMainnetDeployments() {
  const loanManagerAddress =
    mainnetDeployments.contracts.LoanManager.contractInstance.address;
  const auctionManagerAddress =
    mainnetDeployments.contracts.AuctionManager.contractInstance.address;
  const borrowerOperationsAddress =
    mainnetDeployments.contracts.BorrowerOperations.contractInstance.address;
  const stakeManagerAddress =
    mainnetDeployments.contracts.StakeManager.contractInstance.address;

  return {
    contracts: {
      LoanManager: {
        contractInstance: LoanManager.at(loanManagerAddress),
      },
      AuctionManager: {
        contractInstance: AuctionManager.at(auctionManagerAddress),
      },
      BorrowerOperations: {
        contractInstance: BorrowerOperationsV2.at(borrowerOperationsAddress),
      },
      StakeManager: {
        contractInstance: { address: stakeManagerAddress },
      },
    },
  };
}
