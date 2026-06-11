import { addressFromContractId } from "@alephium/web3";
import { ListNode } from "../../../artifacts/artifacts/ts/ListNode";

/**
 * Collect loan contract IDs from the on-chain SortedList.
 * Forward traversal (start → nextId) can miss nodes when links are broken,
 * so backward traversal (end → prevId) fills the gaps — same as exmaples/list-loans.ts.
 */
export async function collectLoanContractIds(
  startNodeId: string,
  endNodeId: string,
  total: number,
  log?: (msg: string) => void,
): Promise<string[]> {
  const seenNodeIds = new Set<string>();
  const loanContractIds: string[] = [];

  async function traverse(
    startId: string,
    nextFn: (fields: { nextId: string; prevId: string }) => string,
    contractIdFn: (fields: { contractId: string }) => string,
    label: string,
  ) {
    let current = startId;
    let itr = 0;
    const limit = total * 2 + 4;

    while (current !== "" && itr < limit && loanContractIds.length < total) {
      if (seenNodeIds.has(current)) break;
      seenNodeIds.add(current);

      log?.(`${label}: ${loanContractIds.length + 1}/${total}`);

      const nodeState = await ListNode.at(addressFromContractId(current)).fetchState();
      const loanId = contractIdFn(nodeState.fields);
      if (loanId && loanId !== "") {
        loanContractIds.push(loanId);
      }
      current = nextFn(nodeState.fields);
      itr++;
    }
  }

  await traverse(startNodeId, (f) => f.nextId, (f) => f.contractId, "Forward");

  if (loanContractIds.length < total) {
    log?.(
      `Forward found ${loanContractIds.length}/${total} — running backward traversal`,
    );
    await traverse(endNodeId, (f) => f.prevId, (f) => f.contractId, "Backward");
  }

  return loanContractIds;
}
