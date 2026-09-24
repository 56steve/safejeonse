// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0
// Wallet connection adapted from midnightntwrk/example-bboard (Apache-2.0).

import {
  SafeJeonseAPI,
  type BuildingRegistration,
  type Persona,
  type SafeJeonseCircuitKeys,
  type SafeJeonseProviders,
  ledgerRows,
  registerBuilding,
  utils,
} from '../../api/src/index';
import { type Backend, type BuildingSession } from './backend';
import { type SafeJeonsePrivateState } from '../../contract/src/witnesses';
import { type ContractAddress, fromHex, toHex } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { concatMap, filter, firstValueFrom, interval, map, take, throwError, timeout } from 'rxjs';
import { type Logger } from 'pino';
import { type ConnectedAPI, type InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import semver from 'semver';
import {
  type Binding,
  type FinalizedTransaction,
  type Proof,
  type SignatureEnabled,
  Transaction,
  type TransactionId,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import { inMemoryPrivateStateProvider } from './in-memory-private-state-provider';

type SharedProviders = Omit<SafeJeonseProviders, 'privateStateProvider'>;

const COMPATIBLE_CONNECTOR_API_VERSION = '4.x';

const toSession = (api: SafeJeonseAPI): BuildingSession => ({
  state$: api.state$,
  createLeaseCode: (amount) => api.createLeaseCode(amount),
  declareDeposit: (code) => api.declareDeposit(code),
  withdrawDeposit: (slot) => api.withdrawDeposit(slot),
  certify: (amount) => api.certify(amount),
  attestRegister: (data) => api.attestRegister(data),
  ledgerRows: async () => ledgerRows(await api.queryLedger()),
});

/**
 * Proves and submits through the Lace wallet extension.
 *
 * In real use every persona is a different person on a different device.
 * The demo lets one browser switch between them; each persona still has its
 * own private state store, so their secrets never mix.
 */
export class LaceBackend implements Backend {
  readonly kind = 'lace' as const;
  #shared: Promise<SharedProviders> | undefined;
  readonly #sessions = new Map<Persona, Promise<BuildingSession>>();
  #address: ContractAddress | undefined;
  /** Identity of the registry office persona for buildings registered from this browser. */
  readonly #registrarSecretKey = utils.randomBytes(32);

  constructor(private readonly logger: Logger) {}

  async register(registration: BuildingRegistration): Promise<string> {
    const { landlord, registrar } = await registerBuilding(
      await this.newPersonaProviders(),
      await this.newPersonaProviders(),
      registration,
      this.#registrarSecretKey,
      this.logger,
    );
    this.#sessions.clear();
    this.#sessions.set('landlord', Promise.resolve(toSession(landlord)));
    this.#sessions.set('registrar', Promise.resolve(toSession(registrar)));
    this.#address = landlord.deployedContractAddress;
    return landlord.deployedContractAddress;
  }

  open(address: ContractAddress): void {
    if (address !== this.#address) {
      this.#sessions.clear();
      this.#address = address;
    }
  }

  /** Returns the session for a persona, joining the building on first use. */
  as(persona: Persona): Promise<BuildingSession> {
    const address = this.#address;
    if (address === undefined) {
      return Promise.reject(new Error('Open or register a building first'));
    }
    const existing = this.#sessions.get(persona);
    if (existing !== undefined) {
      return existing;
    }
    const joined = this.newPersonaProviders()
      .then((providers) =>
        SafeJeonseAPI.join(
          providers,
          address,
          this.logger,
          persona === 'registrar' ? this.#registrarSecretKey : undefined,
        ),
      )
      .then(toSession);
    joined.catch(() => this.#sessions.delete(persona));
    this.#sessions.set(persona, joined);
    return joined;
  }

  /** Shared wallet providers plus a fresh private state store for one persona. */
  private async newPersonaProviders(): Promise<SafeJeonseProviders> {
    const shared = await (this.#shared ??= initializeSharedProviders(this.logger).catch((error: unknown) => {
      this.#shared = undefined;
      throw error;
    }));
    return {
      ...shared,
      privateStateProvider: inMemoryPrivateStateProvider<'safeJeonsePrivateState', SafeJeonsePrivateState>(),
    };
  }
}

const initializeSharedProviders = async (logger: Logger): Promise<SharedProviders> => {
  const networkId = import.meta.env.VITE_NETWORK_ID as string;
  const connectedAPI = await connectToWallet(logger, networkId);
  const keyMaterialProvider = new FetchZkConfigProvider<SafeJeonseCircuitKeys>(
    window.location.origin,
    fetch.bind(window),
  );
  const config = await connectedAPI.getConfiguration();
  if (config.proverServerUri === undefined) {
    throw new Error('Your wallet has no proof server configured. In Lace, set the proof server to Local.');
  }
  const shieldedAddresses = await connectedAPI.getShieldedAddresses();

  return {
    zkConfigProvider: keyMaterialProvider,
    proofProvider: httpClientProofProvider(config.proverServerUri, keyMaterialProvider),
    publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
    walletProvider: {
      getCoinPublicKey: () => shieldedAddresses.shieldedCoinPublicKey,
      getEncryptionPublicKey: () => shieldedAddresses.shieldedEncryptionPublicKey,
      balanceTx: async (tx: UnboundTransaction): Promise<FinalizedTransaction> => {
        const received = await connectedAPI.balanceUnsealedTransaction(toHex(tx.serialize()));
        return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
          'signature',
          'proof',
          'binding',
          fromHex(received.tx),
        );
      },
    },
    midnightProvider: {
      submitTx: async (tx: FinalizedTransaction): Promise<TransactionId> => {
        await connectedAPI.submitTransaction(toHex(tx.serialize()));
        const [txId] = tx.identifiers();
        logger.info({ txId }, 'Submitted transaction');
        return txId;
      },
    },
  };
};

const findWallet = (): InitialAPI | undefined => {
  if (!window.midnight) {
    return undefined;
  }
  return Object.values(window.midnight).find(
    (wallet): wallet is InitialAPI =>
      !!wallet &&
      typeof wallet === 'object' &&
      'apiVersion' in wallet &&
      semver.satisfies(wallet.apiVersion, COMPATIBLE_CONNECTOR_API_VERSION),
  );
};

const connectToWallet = (logger: Logger, networkId: string): Promise<ConnectedAPI> =>
  firstValueFrom(
    interval(100).pipe(
      map(() => findWallet()),
      filter((wallet): wallet is InitialAPI => wallet !== undefined),
      take(1),
      timeout({
        first: 2_000,
        with: () => throwError(() => new Error('No Midnight wallet found. Install Lace and enable Midnight.')),
      }),
      concatMap(async (wallet) => {
        const connected = await wallet.connect(networkId);
        logger.info(await connected.getConnectionStatus(), 'Wallet connected');
        return connected;
      }),
      timeout({
        first: 60_000,
        with: () => throwError(() => new Error('The wallet did not respond. Is it unlocked?')),
      }),
    ),
  );
