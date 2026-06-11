import { LoanManager } from "../../../artifacts/artifacts/ts/LoanManager";
import mainnetDeployments from "../../contracts/deployments.mainnet.json";

export function loadMainnetDeployments() {
  const loanManagerAddress =
    mainnetDeployments.contracts.LoanManager.contractInstance.address;

  return {
    contracts: {
      LoanManager: {
        contractInstance: LoanManager.at(loanManagerAddress),
      },
    },
  };
}
