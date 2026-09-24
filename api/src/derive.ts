// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

/**
 * Turns raw ledger state plus local private state into the view the apps render.
 * Pure and synchronous so it can be tested without a network.
 *
 * @module
 */

import { type Ledger, pureCircuits } from '../../contract/src/managed/safejeonse/contract/index.js';
import { type SafeJeonsePrivateState } from '../../contract/src/witnesses.js';
import { type SafeJeonseDerivedState, type SlotView } from './common-types.js';
import { EMPTY_COMMITMENT_HEX, exposureLimit } from './lease.js';

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Mirrors `pad(32, role)` in the contract. */
const roleBytes = (role: 'landlord' | 'tenant' | 'registrar'): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(role));
  return bytes;
};

export const landlordPublicKey = (secretKey: Uint8Array): Uint8Array =>
  pureCircuits.partyKey(roleBytes('landlord'), secretKey);

export const tenantPublicKey = (secretKey: Uint8Array): Uint8Array =>
  pureCircuits.partyKey(roleBytes('tenant'), secretKey);

export const registrarPublicKey = (secretKey: Uint8Array): Uint8Array =>
  pureCircuits.partyKey(roleBytes('registrar'), secretKey);

export const deriveState = (ledger: Ledger, privateState: SafeJeonsePrivateState): SafeJeonseDerivedState => {
  const myTenantKey = toHex(tenantPublicKey(privateState.secretKey));

  const slots: SlotView[] = [];
  for (const [slot, commitment] of ledger.declarations) {
    slots.push({
      slot,
      occupied: toHex(commitment) !== EMPTY_COMMITMENT_HEX,
      declaredByMe: ledger.slotOwner.member(slot) && toHex(ledger.slotOwner.lookup(slot)) === myTenantKey,
    });
  }
  slots.sort((a, b) => (a.slot < b.slot ? -1 : 1));

  const building = {
    buildingValue: ledger.buildingValue,
    seniorLiens: ledger.seniorLiens,
    safeRatioPercent: ledger.safeRatioPercent,
  };

  const activeSlots = new Set(slots.filter((s) => s.declaredByMe).map((s) => s.slot));

  return {
    building,
    exposureLimit: exposureLimit(building.buildingValue, building.safeRatioPercent),
    isLandlord: toHex(ledger.landlord) === toHex(landlordPublicKey(privateState.secretKey)),
    isRegistrar: toHex(ledger.registrar) === toHex(registrarPublicKey(privateState.secretKey)),
    attested: ledger.attested,
    registerUpdates: ledger.attestCount,
    slots,
    declaredCount: ledger.declaredCount,
    revision: ledger.revision,
    certificate: ledger.certIssued
      ? {
          newDeposit: ledger.certNewDeposit,
          safe: ledger.certSafe,
          stale: ledger.certRevision !== ledger.revision,
          issuedAtRevision: ledger.certRevision,
        }
      : null,
    certificatesIssued: ledger.certCount,
    myDeposits: privateState.myDeclarations
      .filter((d) => activeSlots.has(d.slot))
      .map((d) => ({ slot: d.slot, amount: d.opening.amount })),
    leaseCodesIssued: privateState.issuedLeases.length,
  };
};
