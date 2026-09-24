// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { describe, expect, it } from 'vitest';
import { createSafeJeonsePrivateState } from '../../../contract/src/witnesses.js';
import { deriveState } from '../derive.js';
import { newOpening, resolveLeaseBook } from '../lease.js';
import { randomBytes } from '../utils/index.js';
import { attestedBuilding } from './building.js';
import { WireFormatError, bigintReplacer, decodeDerivedState, ledgerRows } from '../wire.js';

setNetworkId('undeployed');

const buildScenario = () => {
  const landlordKey = randomBytes(32);
  const sim = attestedBuilding(landlordKey);
  const tenantKey = randomBytes(32);
  const opening = newOpening(8_000n, randomBytes);
  sim.as(createSafeJeonsePrivateState(tenantKey, opening)).declareDeposit();
  const book = resolveLeaseBook(sim.getLedger().declarations, [opening]);
  sim.as(createSafeJeonsePrivateState(landlordKey, null, book)).certify(7_000n);
  const tenantView = deriveState(
    sim.getLedger(),
    createSafeJeonsePrivateState(tenantKey, null, [], [], [{ slot: 0n, opening }]),
  );
  return { sim, tenantView };
};

describe('wire format', () => {
  it('round-trips derived state through JSON', () => {
    const { tenantView } = buildScenario();
    const json: unknown = JSON.parse(JSON.stringify(tenantView, bigintReplacer));
    expect(decodeDerivedState(json)).toEqual(tenantView);
  });

  it('rejects a response with a missing field', () => {
    const { tenantView } = buildScenario();
    const json = JSON.parse(JSON.stringify(tenantView, bigintReplacer)) as Record<string, unknown>;
    delete json.exposureLimit;
    expect(() => decodeDerivedState(json)).toThrow(WireFormatError);
  });

  it('rejects a non-numeric amount', () => {
    const { tenantView } = buildScenario();
    const json = JSON.parse(JSON.stringify(tenantView, bigintReplacer)) as Record<string, unknown>;
    json.revision = '12abc';
    expect(() => decodeDerivedState(json)).toThrow(/revision/);
  });

  it('lists the ledger in slot order and marks empty slots', () => {
    const { sim } = buildScenario();
    const rows = ledgerRows(sim.getLedger());
    const slotRows = rows.filter((row) => row.label.startsWith('declarations['));
    expect(slotRows.map((row) => row.label)).toEqual(Array.from({ length: 8 }, (_, i) => `declarations[${i}]`));
    expect(slotRows[0].emptySlot).toBe(false);
    expect(slotRows.slice(1).every((row) => row.emptySlot === true)).toBe(true);
    expect(rows.find((row) => row.label === 'certSafe')?.value).toBe('true');
  });

  it('never contains the hidden deposit amount', () => {
    const { sim } = buildScenario();
    const values = ledgerRows(sim.getLedger()).map((row) => row.value);
    expect(values).not.toContain('8000');
  });
});
