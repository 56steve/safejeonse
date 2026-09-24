// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

import { Observable, distinctUntilChanged, from, map, retry, shareReplay, switchMap, timer } from 'rxjs';
import {
  type BuildingRegistration,
  type LedgerRow,
  type Persona,
  type SafeJeonseDerivedState,
  bigintReplacer,
  decodeDerivedState,
} from '../../api/src/index';
import { type Backend, type BuildingSession } from './backend';

const POLL_MS = 2_000;

const request = async <T>(path: string, init?: { method: 'POST'; body: unknown }): Promise<T> => {
  const response = await fetch(path, {
    method: init?.method ?? 'GET',
    headers: init === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init === undefined ? undefined : JSON.stringify(init.body, bigintReplacer),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
};

/**
 * Talks to the local demo server started by `npm run web`. The server builds the
 * proofs and submits the transactions, so the browser needs no wallet.
 */
export class LocalBackend implements Backend {
  readonly kind = 'local' as const;
  #address: string | undefined;
  readonly #sessions = new Map<Persona, Promise<BuildingSession>>();

  async register(registration: BuildingRegistration): Promise<string> {
    const { address } = await request<{ address: string }>('/api/buildings', {
      method: 'POST',
      body: registration,
    });
    this.open(address);
    return address;
  }

  open(address: string): void {
    if (address !== this.#address) {
      this.#sessions.clear();
      this.#address = address;
    }
  }

  as(persona: Persona): Promise<BuildingSession> {
    const address = this.#address;
    if (address === undefined) {
      return Promise.reject(new Error('Open or register a building first'));
    }
    const existing = this.#sessions.get(persona);
    if (existing !== undefined) {
      return existing;
    }
    const session = this.connect(address, persona);
    session.catch(() => this.#sessions.delete(persona));
    this.#sessions.set(persona, session);
    return session;
  }

  private async connect(address: string, persona: Persona): Promise<BuildingSession> {
    const base = `/api/buildings/${encodeURIComponent(address)}`;
    const fetchState = async () =>
      decodeDerivedState(await request<unknown>(`${base}/state?persona=${encodeURIComponent(persona)}`));

    // Fail fast if the building can't be read, then keep polling for updates.
    const first = await fetchState();
    const state$: Observable<SafeJeonseDerivedState> = timer(POLL_MS, POLL_MS).pipe(
      switchMap(() => from(fetchState())),
      retry({ delay: POLL_MS }),
      map((state) => ({ state, key: JSON.stringify(state, bigintReplacer) })),
      distinctUntilChanged((a, b) => a.key === b.key),
      map(({ state }) => state),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    const post = <T>(action: string, body: Record<string, unknown>) =>
      request<T>(`${base}/${action}`, { method: 'POST', body: { persona, ...body } });

    return {
      state$: new Observable<SafeJeonseDerivedState>((subscriber) => {
        subscriber.next(first);
        return state$.subscribe(subscriber);
      }),
      createLeaseCode: async (amount) => (await post<{ code: string }>('lease-codes', { amount })).code,
      declareDeposit: async (code) => BigInt((await post<{ slot: string }>('declare', { code })).slot),
      withdrawDeposit: async (slot) => {
        await post('withdraw', { slot });
      },
      certify: async (amount) => (await post<{ safe: boolean }>('certify', { amount })).safe,
      attestRegister: async (data) => {
        await post('attest', { buildingValue: data.buildingValue, seniorLiens: data.seniorLiens });
      },
      ledgerRows: async () => (await request<{ rows: LedgerRow[] }>(`${base}/ledger`)).rows,
    };
  }
}
