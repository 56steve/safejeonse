// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { beforeEach, describe, expect, it } from 'vitest';
import { SafeJeonseSimulator } from '../../../contract/src/test/safejeonse-simulator.js';
import { createSafeJeonsePrivateState } from '../../../contract/src/witnesses.js';
import { deriveState } from '../derive.js';
import { newOpening, resolveLeaseBook } from '../lease.js';
import { randomBytes } from '../utils/index.js';

setNetworkId('undeployed');

describe('deriveState', () => {
  let landlordKey: Uint8Array;
  let sim: SafeJeonseSimulator;

  beforeEach(() => {
    landlordKey = randomBytes(32);
    sim = new SafeJeonseSimulator(landlordKey, { value: 50_000n, liens: 20_000n, ratioPercent: 70n });
  });

  it('recognises the landlord and computes the exposure limit', () => {
    const view = deriveState(sim.getLedger(), createSafeJeonsePrivateState(landlordKey));
    expect(view.isLandlord).toBe(true);
    expect(view.exposureLimit).toBe(35_000n);
    expect(view.slots).toHaveLength(8);
    expect(view.slots.every((s) => !s.occupied)).toBe(true);
    expect(view.certificate).toBeNull();
  });

  it('shows a tenant only their own slot and amount', () => {
    const opening = newOpening(3_000n, randomBytes);
    const tenantKey = randomBytes(32);
    sim.as(createSafeJeonsePrivateState(tenantKey, opening)).declareDeposit();
    sim.as(createSafeJeonsePrivateState(randomBytes(32), newOpening(4_000n, randomBytes))).declareDeposit();

    const tenantState = createSafeJeonsePrivateState(tenantKey, null, [], [], [{ slot: 0n, opening }]);
    const view = deriveState(sim.getLedger(), tenantState);

    expect(view.isLandlord).toBe(false);
    expect(view.slots.filter((s) => s.occupied)).toHaveLength(2);
    expect(view.slots.filter((s) => s.declaredByMe).map((s) => s.slot)).toEqual([0n]);
    expect(view.myDeposits).toEqual([{ slot: 0n, amount: 3_000n }]);
  });

  it('flags a certificate as stale once deposits change', () => {
    const a = newOpening(3_000n, randomBytes);
    sim.as(createSafeJeonsePrivateState(randomBytes(32), a)).declareDeposit();
    const book = resolveLeaseBook(sim.getLedger().declarations, [a]);
    expect(sim.as(createSafeJeonsePrivateState(landlordKey, null, book)).certify(5_000n)).toBe(true);

    const fresh = deriveState(sim.getLedger(), createSafeJeonsePrivateState(landlordKey));
    expect(fresh.certificate).toEqual({ newDeposit: 5_000n, safe: true, stale: false, issuedAtRevision: 1n });

    sim.as(createSafeJeonsePrivateState(randomBytes(32), newOpening(1_000n, randomBytes))).declareDeposit();
    const stale = deriveState(sim.getLedger(), createSafeJeonsePrivateState(landlordKey));
    expect(stale.certificate?.stale).toBe(true);
  });
});
