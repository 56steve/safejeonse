// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0
// Wallet and environment bootstrapping adapted from midnightntwrk/example-bboard (Apache-2.0).

/*
 * Terminal app for SafeJeonse. The launchers in ./launcher call `run` with a
 * network config and either the interactive menu or the scripted demo.
 *
 * One wallet pays the fees, but every persona (landlord, tenants, renter) has
 * its own private state store, so their secrets never mix.
 */

import { createInterface, type Interface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { WebSocket } from 'ws';
import {
  SafeJeonseAPI,
  type SafeJeonseProviders,
  type PrivateStateId,
  UnknownDeclarationError,
  InvalidLeaseCodeError,
  formatManwon,
} from '../../api/src/index';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { type Logger } from 'pino';
import { type Config, StandaloneConfig } from './config.js';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { type EnvironmentConfiguration, type TestEnvironment } from '@midnight-ntwrk/testkit-js';
import { MidnightWalletProvider } from './midnight-wallet-provider';
import { randomBytes } from '../../api/src/utils';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { syncWallet, waitForUnshieldedFunds } from './wallet-utils';
import { generateDust } from './generate-dust';
import { type SafeJeonsePrivateState } from '../../contract/src/witnesses.js';
import { bold, dim, heading, printBlock, red, renderBuilding, renderPrivate, renderRawLedger, say } from './view.js';

// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

type CircuitId = 'declareDeposit' | 'withdrawDeposit' | 'certify';

/** Builds the providers for one persona. Each persona gets its own private state store. */
export type ProviderFactory = (persona: string) => SafeJeonseProviders;

export type Session = {
  readonly providers: ProviderFactory;
  readonly logger: Logger;
};

const PERSONA_PATTERN = /^[a-z0-9-]{1,32}$/;

const makeProviderFactory = (
  config: Config,
  env: EnvironmentConfiguration,
  walletProvider: MidnightWalletProvider,
  seed: string,
): ProviderFactory => {
  const zkConfigProvider = new NodeZkConfigProvider<CircuitId>(config.zkConfigPath);
  const publicDataProvider = indexerPublicDataProvider(env.indexer, env.indexerWS);
  const proofProvider = httpClientProofProvider(env.proofServer, zkConfigProvider);
  const cache = new Map<string, SafeJeonseProviders>();

  return (persona) => {
    if (!PERSONA_PATTERN.test(persona)) {
      throw new Error(`Persona names use lowercase letters, digits and dashes (got "${persona}")`);
    }
    const existing = cache.get(persona);
    if (existing !== undefined) {
      return existing;
    }
    const storeName = `${config.privateStateStoreName}-${persona}`;
    const providers: SafeJeonseProviders = {
      privateStateProvider: levelPrivateStateProvider<PrivateStateId, SafeJeonsePrivateState>({
        privateStateStoreName: storeName,
        signingKeyStoreName: `${storeName}-signing-keys`,
        privateStoragePasswordProvider: () => config.privateStoragePassword,
        accountId: seed,
      }),
      publicDataProvider,
      zkConfigProvider,
      proofProvider,
      walletProvider,
      midnightProvider: walletProvider,
    };
    cache.set(persona, providers);
    return providers;
  };
};

/* ------------------------------------------------------------------------- */
/* Interactive menu                                                          */
/* ------------------------------------------------------------------------- */

const askAmount = async (rli: Interface, question: string): Promise<bigint> => {
  const text = (await rli.question(question)).replace(/[,\s]/g, '');
  if (!/^\d+$/.test(text) || BigInt(text) <= 0n) {
    throw new RangeError(`"${text}" is not a positive whole number of 만원`);
  }
  return BigInt(text);
};

const START_QUESTION = `
  1. Register a new building (you become the landlord)
  2. Open an existing building by contract address
  3. Exit
> `;

const openBuilding = async (session: Session, rli: Interface): Promise<SafeJeonseAPI | null> => {
  while (true) {
    const choice = (await rli.question(START_QUESTION)).trim();
    try {
      switch (choice) {
        case '1': {
          say(dim('Amounts are in 만원 (10,000 KRW). Example: 50000 = 5억'));
          const buildingValue = await askAmount(rli, 'Building value (공시가격): ');
          const seniorLiens = BigInt(
            (await rli.question('Senior liens from the property register (근저당), 0 if none: ')).trim() || '0',
          );
          const ratioText = (await rli.question('Safe ratio in percent [70]: ')).trim();
          const safeRatioPercent = BigInt(ratioText === '' ? '70' : ratioText);
          say(dim('Deploying the building contract. This takes a little while...'));
          const api = await SafeJeonseAPI.deploy(
            session.providers('landlord'),
            { buildingValue, seniorLiens, safeRatioPercent },
            session.logger,
          );
          say(bold(`Building registered at ${api.deployedContractAddress}`));
          return api;
        }
        case '2': {
          const address = (await rli.question('Contract address: ')).trim();
          const persona = (await rli.question('Who are you? (landlord, tenant-1, renter, ...): ')).trim() || 'landlord';
          return await SafeJeonseAPI.join(session.providers(persona), address, session.logger);
        }
        case '3':
          return null;
        default:
          say(red(`Unknown choice "${choice}"`));
      }
    } catch (error) {
      reportError(session.logger, error);
    }
  }
};

const MAIN_QUESTION = (persona: string) => `
Acting as ${bold(persona)}
  1. Show the building
  2. [landlord] Create a lease code for a new tenant
  3. [tenant]   Declare my deposit from a lease code
  4. [tenant]   Withdraw my deposit (after moving out)
  5. [landlord] Prove whether a new deposit would be safe
  6. Show the raw on-chain data (what everyone can see)
  7. Switch persona
  8. Exit
> `;

const mainLoop = async (session: Session, rli: Interface): Promise<void> => {
  const first = await openBuilding(session, rli);
  if (first === null) {
    return;
  }
  const address = first.deployedContractAddress;
  const personas = new Map<string, SafeJeonseAPI>([['landlord', first]]);
  let persona = 'landlord';
  let api = first;

  while (true) {
    const choice = (await rli.question(MAIN_QUESTION(persona))).trim();
    try {
      switch (choice) {
        case '1': {
          const state = await api.currentState();
          heading('Public view');
          printBlock(renderBuilding(state));
          heading(`Private to ${persona}`);
          printBlock(renderPrivate(state));
          break;
        }
        case '2': {
          const amount = await askAmount(rli, 'Deposit in 만원: ');
          const code = await api.createLeaseCode(amount);
          say(`Give this code to the tenant together with the lease contract:\n  ${bold(code)}`);
          break;
        }
        case '3': {
          const code = await rli.question('Lease code: ');
          say(dim('Generating a zero-knowledge proof and submitting...'));
          const slot = await api.declareDeposit(code);
          say(bold(`Deposit declared in slot ${slot}. Only a commitment went on-chain.`));
          break;
        }
        case '4': {
          const slot = BigInt((await rli.question('Slot number: ')).trim());
          await api.withdrawDeposit(slot);
          say(bold(`Slot ${slot} released.`));
          break;
        }
        case '5': {
          const amount = await askAmount(rli, 'New deposit being offered, in 만원: ');
          say(dim('Proving against every declared deposit...'));
          const safe = await api.certify(amount);
          say(`${formatManwon(amount)} → ${safe ? bold('SAFE') : red(bold('RISKY'))}`);
          break;
        }
        case '6':
          heading('Raw public ledger');
          printBlock(renderRawLedger(await api.queryLedger()));
          break;
        case '7': {
          const next = (await rli.question('Persona name (landlord, tenant-1, renter, ...): ')).trim();
          const existing = personas.get(next);
          api = existing ?? (await SafeJeonseAPI.join(session.providers(next), address, session.logger));
          personas.set(next, api);
          persona = next;
          break;
        }
        case '8':
          return;
        default:
          say(red(`Unknown choice "${choice}"`));
      }
    } catch (error) {
      reportError(session.logger, error);
    }
  }
};

/* ------------------------------------------------------------------------- */
/* Wallet + environment                                                      */
/* ------------------------------------------------------------------------- */

/** Seed of the wallet funded in the genesis block of a local dev node. Only used on the local network. */
const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

const WALLET_QUESTION = `
  1. Build a fresh wallet
  2. Restore a wallet from a seed
  3. Exit
> `;

const chooseSeed = async (config: Config, rli: Interface): Promise<string | undefined> => {
  if (config instanceof StandaloneConfig) {
    return GENESIS_MINT_WALLET_SEED;
  }
  const fromEnv = process.env.SAFEJEONSE_WALLET_SEED;
  if (fromEnv !== undefined && fromEnv !== '') {
    return fromEnv;
  }
  while (true) {
    const choice = (await rli.question(WALLET_QUESTION)).trim();
    switch (choice) {
      case '1': {
        const seed = toHex(randomBytes(32));
        say(`New wallet seed (save it): ${bold(seed)}`);
        return seed;
      }
      case '2':
        return (await rli.question('Wallet seed: ')).trim();
      case '3':
        return undefined;
      default:
        say(red(`Unknown choice "${choice}"`));
    }
  }
};

export type Mode =
  { readonly kind: 'interactive' } | { readonly kind: 'script'; readonly script: (session: Session) => Promise<void> };

export const run = async (config: Config, testEnv: TestEnvironment, logger: Logger, mode: Mode): Promise<void> => {
  const rli = createInterface({ input, output, terminal: process.stdin.isTTY });
  const walletsToStop: MidnightWalletProvider[] = [];
  try {
    say(dim('Starting the Midnight network services...'));
    const env = await testEnv.start();
    logger.debug({ environment: env });

    const seed = await chooseSeed(config, rli);
    if (seed === undefined) {
      return;
    }
    const walletProvider = await MidnightWalletProvider.build(logger, env, seed);
    walletsToStop.push(walletProvider);
    const walletFacade: WalletFacade = walletProvider.wallet;
    await walletProvider.start();

    say(dim('Waiting for the wallet to sync and receive funds...'));
    const unshieldedState = await waitForUnshieldedFunds(logger, walletFacade, env, unshieldedToken());
    const nightBalance = unshieldedState.balances[unshieldedToken().raw];
    if (nightBalance === undefined) {
      say(red('The wallet has no funds. Use the faucet and try again.'));
      return;
    }
    logger.info(`NIGHT balance: ${nightBalance}`);

    if (config.generateDust) {
      const dustTx = await generateDust(logger, seed, unshieldedState, walletFacade);
      if (dustTx) {
        logger.info(`Submitted DUST generation registration: ${dustTx}`);
        await syncWallet(logger, walletFacade);
      }
    }

    const session: Session = { providers: makeProviderFactory(config, env, walletProvider, seed), logger };
    if (mode.kind === 'interactive') {
      await mainLoop(session, rli);
    } else {
      await mode.script(session);
    }
  } catch (error) {
    reportError(logger, error);
    process.exitCode = 1;
  } finally {
    rli.close();
    for (const wallet of walletsToStop) {
      await wallet.stop().catch((error: unknown) => reportError(logger, error));
    }
    say(dim('Stopping the network services...'));
    await testEnv.shutdown().catch((error: unknown) => reportError(logger, error));
  }
};

export const reportError = (logger: Logger, error: unknown): void => {
  if (
    error instanceof UnknownDeclarationError ||
    error instanceof InvalidLeaseCodeError ||
    error instanceof RangeError
  ) {
    say(red(error.message));
  } else if (error instanceof Error) {
    say(red(`Error: ${error.message}`));
    logger.debug(error.stack ?? '');
  } else {
    say(red(`Unexpected error: ${String(error)}`));
  }
};
