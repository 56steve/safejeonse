// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

/**
 * API for deploying, joining and using a SafeJeonse building contract.
 * Shared by the CLI and the browser UI.
 *
 * @packageDocumentation
 */

import * as SafeJeonse from '../../contract/src/managed/safejeonse/contract/index.js';

import { type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type Logger } from 'pino';
import {
  type BuildingRegistration,
  type DeployedSafeJeonseContract,
  type SafeJeonseContract,
  type SafeJeonseDerivedState,
  type SafeJeonseProviders,
  safeJeonsePrivateStateKey,
} from './common-types.js';
import { CompiledSafeJeonseContract } from '../../contract/src/index';
import * as utils from './utils/index.js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { BehaviorSubject, combineLatest, map, type Observable } from 'rxjs';
import {
  type DepositOpening,
  type SafeJeonsePrivateState,
  createSafeJeonsePrivateState,
  MAX_UNITS,
} from '../../contract/src/witnesses.js';
import { assertValidAmount, decodeLeaseCode, encodeLeaseCode, newOpening, resolveLeaseBook } from './lease.js';
import { deriveState } from './derive.js';

export interface DeployedSafeJeonseAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<SafeJeonseDerivedState>;

  createLeaseCode: (amount: bigint) => Promise<string>;
  declareDeposit: (leaseCode: string) => Promise<bigint>;
  withdrawDeposit: (slot: bigint) => Promise<void>;
  certify: (newDeposit: bigint) => Promise<boolean>;
}

export const validateRegistration = (registration: BuildingRegistration): void => {
  assertValidAmount(registration.buildingValue);
  if (registration.seniorLiens < 0n) {
    throw new RangeError('Senior liens cannot be negative');
  }
  if (registration.safeRatioPercent < 1n || registration.safeRatioPercent > 100n) {
    throw new RangeError('Safe ratio must be between 1 and 100 percent');
  }
};

/**
 * One building's SafeJeonse contract, seen from the current user.
 *
 * The same secret key can act as landlord (if it deployed the building) and as
 * a tenant; the contract derives separate public keys for each role.
 */
export class SafeJeonseAPI implements DeployedSafeJeonseAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<SafeJeonseDerivedState>;

  private readonly privateState$: BehaviorSubject<SafeJeonsePrivateState>;

  private constructor(
    private readonly deployedContract: DeployedSafeJeonseContract,
    private readonly providers: SafeJeonseProviders,
    initialPrivateState: SafeJeonsePrivateState,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    providers.privateStateProvider.setContractAddress(this.deployedContractAddress);
    this.privateState$ = new BehaviorSubject(initialPrivateState);

    const ledger$ = providers.publicDataProvider
      .contractStateObservable(this.deployedContractAddress, { type: 'latest' })
      .pipe(map((contractState) => SafeJeonse.ledger(contractState.data)));

    this.state$ = combineLatest([ledger$, this.privateState$], deriveState);
  }

  /**
   * Landlord: create a lease code for a new tenant. The code carries the deposit
   * amount and a random salt; the tenant uses it to declare the deposit on-chain.
   */
  async createLeaseCode(amount: bigint): Promise<string> {
    const opening = newOpening(amount, utils.randomBytes);
    await this.updatePrivateState((ps) => ({ ...ps, issuedLeases: [...ps.issuedLeases, opening] }));
    this.logger?.info({ leaseCodeCreated: { amount: amount.toString() } });
    return encodeLeaseCode(opening);
  }

  /**
   * Tenant: declare the deposit from a lease code as a hidden commitment.
   * Returns the slot the deposit was placed in.
   */
  async declareDeposit(leaseCode: string): Promise<bigint> {
    const opening = decodeLeaseCode(leaseCode);
    await this.updatePrivateState((ps) => ({ ...ps, ownDeposit: opening }));

    try {
      const txData = await this.deployedContract.callTx.declareDeposit();
      const slot = txData.private.result;
      this.logTx('declareDeposit', txData.public);
      await this.updatePrivateState((ps) => ({
        ...ps,
        ownDeposit: null,
        myDeclarations: [...ps.myDeclarations.filter((d) => d.slot !== slot), { slot, opening }],
      }));
      return slot;
    } catch (error) {
      await this.updatePrivateState((ps) => ({ ...ps, ownDeposit: null }));
      throw error;
    }
  }

  /** Tenant: remove my declaration after my deposit has been returned. */
  async withdrawDeposit(slot: bigint): Promise<void> {
    if (slot < 0n || slot >= BigInt(MAX_UNITS)) {
      throw new RangeError(`Slot must be between 0 and ${MAX_UNITS - 1}`);
    }
    const txData = await this.deployedContract.callTx.withdrawDeposit(slot);
    this.logTx('withdrawDeposit', txData.public);
    await this.updatePrivateState((ps) => ({
      ...ps,
      myDeclarations: ps.myDeclarations.filter((d) => d.slot !== slot),
    }));
  }

  /**
   * Landlord: prove whether a new deposit would be safe. Only the verdict is
   * published; the proof shows it was computed from every declared deposit.
   */
  async certify(newDeposit: bigint): Promise<boolean> {
    assertValidAmount(newDeposit);
    const ledger = await this.queryLedger();
    const leaseBook = resolveLeaseBook(ledger.declarations, this.privateState$.value.issuedLeases);
    return this.certifyWithLeaseBook(newDeposit, leaseBook);
  }

  /**
   * Landlord: certify using an explicit per-slot list of openings, skipping the
   * app-side matching. The circuit still checks every opening against the
   * on-chain commitments, so wrong numbers make proof generation fail.
   */
  async certifyWithLeaseBook(newDeposit: bigint, leaseBook: ReadonlyArray<DepositOpening | null>): Promise<boolean> {
    assertValidAmount(newDeposit);
    if (leaseBook.length > MAX_UNITS) {
      throw new RangeError(`A lease book has at most ${MAX_UNITS} entries`);
    }
    await this.updatePrivateState((ps) => ({ ...ps, leaseBook }));
    const txData = await this.deployedContract.callTx.certify(newDeposit);
    this.logTx('certify', txData.public);
    return txData.private.result;
  }

  /** Reads the latest ledger and combines it with this user's private state. */
  async currentState(): Promise<SafeJeonseDerivedState> {
    return deriveState(await this.queryLedger(), this.privateState$.value);
  }

  /** The raw public ledger: exactly what anyone watching the chain can see. */
  async queryLedger(): Promise<SafeJeonse.Ledger> {
    const contractState = await this.providers.publicDataProvider.queryContractState(this.deployedContractAddress);
    if (contractState === null) {
      throw new Error(`No contract found at ${this.deployedContractAddress}`);
    }
    return SafeJeonse.ledger(contractState.data);
  }

  private async updatePrivateState(update: (current: SafeJeonsePrivateState) => SafeJeonsePrivateState): Promise<void> {
    const next = update(this.privateState$.value);
    await this.providers.privateStateProvider.set(safeJeonsePrivateStateKey, next);
    this.privateState$.next(next);
  }

  private logTx(circuit: string, publicData: { txHash: string; blockHeight: number }): void {
    this.logger?.info({
      transactionAdded: { circuit, txHash: publicData.txHash, blockHeight: publicData.blockHeight },
    });
  }

  /** Landlord: register a building by deploying a new contract. */
  static async deploy(
    providers: SafeJeonseProviders,
    registration: BuildingRegistration,
    logger?: Logger,
  ): Promise<SafeJeonseAPI> {
    validateRegistration(registration);
    logger?.info({
      deployContract: {
        buildingValue: registration.buildingValue.toString(),
        seniorLiens: registration.seniorLiens.toString(),
        safeRatioPercent: registration.safeRatioPercent.toString(),
      },
    });

    const initialPrivateState = createSafeJeonsePrivateState(utils.randomBytes(32));
    const deployed = await deployContract(providers, {
      compiledContract: CompiledSafeJeonseContract,
      privateStateId: safeJeonsePrivateStateKey,
      initialPrivateState,
      args: [registration.buildingValue, registration.seniorLiens, registration.safeRatioPercent],
    });

    logger?.info({ contractDeployed: { address: deployed.deployTxData.public.contractAddress } });
    return new SafeJeonseAPI(deployed, providers, initialPrivateState, logger);
  }

  /** Join an existing building, as a tenant, a prospective tenant, or its landlord. */
  static async join(
    providers: SafeJeonseProviders,
    contractAddress: ContractAddress,
    logger?: Logger,
  ): Promise<SafeJeonseAPI> {
    logger?.info({ joinContract: { contractAddress } });
    const initialPrivateState = await SafeJeonseAPI.getPrivateState(providers, contractAddress);
    const found = await findDeployedContract<SafeJeonseContract>(providers, {
      contractAddress,
      compiledContract: CompiledSafeJeonseContract,
      privateStateId: safeJeonsePrivateStateKey,
      initialPrivateState,
    });
    return new SafeJeonseAPI(found, providers, initialPrivateState, logger);
  }

  private static async getPrivateState(
    providers: SafeJeonseProviders,
    contractAddress: ContractAddress,
  ): Promise<SafeJeonsePrivateState> {
    providers.privateStateProvider.setContractAddress(contractAddress);
    const existing = await providers.privateStateProvider.get(safeJeonsePrivateStateKey);
    return existing ?? createSafeJeonsePrivateState(utils.randomBytes(32));
  }
}

export * as utils from './utils/index.js';
export * from './common-types.js';
export * from './lease.js';
export * from './derive.js';
export * from './wire.js';
