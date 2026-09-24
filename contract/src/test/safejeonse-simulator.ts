// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  type Ledger,
  ledger,
  pureCircuits,
} from "../managed/safejeonse/contract/index.js";
import {
  type DepositOpening,
  type SafeJeonsePrivateState,
  createSafeJeonsePrivateState,
  witnesses,
} from "../witnesses.js";

export type BuildingParams = {
  registrarPublicKey: Uint8Array;
  ratioPercent: bigint;
};

/** Mirrors `partyKey(pad(32, role), sk)` in the contract. */
export const rolePublicKey = (
  role: "landlord" | "tenant" | "registrar",
  secretKey: Uint8Array,
): Uint8Array => {
  const roleBytes = new Uint8Array(32);
  roleBytes.set(new TextEncoder().encode(role));
  return pureCircuits.partyKey(roleBytes, secretKey);
};

/**
 * In-memory testbed that runs the SafeJeonse circuits without a network.
 * Each "user" is represented by swapping the private state before a call.
 */
export class SafeJeonseSimulator {
  readonly contract: Contract<SafeJeonsePrivateState>;
  circuitContext: CircuitContext<SafeJeonsePrivateState>;

  constructor(landlordSecretKey: Uint8Array, params: BuildingParams) {
    this.contract = new Contract<SafeJeonsePrivateState>(witnesses);
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      createConstructorContext(
        createSafeJeonsePrivateState(landlordSecretKey),
        "0".repeat(64),
      ),
      params.registrarPublicKey,
      params.ratioPercent,
    );
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(
        currentContractState.data,
        sampleContractAddress(),
      ),
    };
  }

  public as(privateState: SafeJeonsePrivateState): this {
    this.circuitContext.currentPrivateState = privateState;
    return this;
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public attestRegister(value: bigint, liens: bigint): void {
    this.circuitContext = this.contract.impureCircuits.attestRegister(
      this.circuitContext,
      value,
      liens,
    ).context;
  }

  public declareDeposit(): bigint {
    const { context, result } = this.contract.impureCircuits.declareDeposit(
      this.circuitContext,
    );
    this.circuitContext = context;
    return result;
  }

  public withdrawDeposit(slot: bigint): void {
    this.circuitContext = this.contract.impureCircuits.withdrawDeposit(
      this.circuitContext,
      slot,
    ).context;
  }

  public certify(newDeposit: bigint): boolean {
    const { context, result } = this.contract.impureCircuits.certify(
      this.circuitContext,
      newDeposit,
    );
    this.circuitContext = context;
    return result;
  }

  public static commitmentOf(opening: DepositOpening): Uint8Array {
    return pureCircuits.depositCommitment(opening);
  }
}
