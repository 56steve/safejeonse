// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

/**
 * JSON encoding for view state and ledger rows, used between the local web
 * server and the browser. JSON has no bigint, so amounts travel as strings.
 *
 * @module
 */

import { type Ledger, pureCircuits } from '../../contract/src/managed/safejeonse/contract/index.js';
import { type SafeJeonseDerivedState } from './common-types.js';

export class WireFormatError extends Error {
  constructor(field: string) {
    super(`Malformed response from the server: bad or missing "${field}"`);
    this.name = 'WireFormatError';
  }
}

/** One labelled row of the raw public ledger. */
export type LedgerRow = {
  readonly label: string;
  readonly value: string;
  /** True for a deposit slot that holds the empty commitment. */
  readonly emptySlot?: boolean;
};

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const shortHex = (bytes: Uint8Array): string => `${toHex(bytes).slice(0, 16)}…`;

/** Everything stored in the contract, in a stable order. Nothing private can appear here. */
export const ledgerRows = (ledger: Ledger): LedgerRow[] => {
  const empty = toHex(pureCircuits.emptyCommitment());
  const slots = Array.from(ledger.declarations).sort(([a], [b]) => (a < b ? -1 : 1));
  return [
    { label: 'landlord', value: shortHex(ledger.landlord) },
    { label: 'attested', value: String(ledger.attested) },
    { label: 'attestCount', value: ledger.attestCount.toString() },
    { label: 'buildingValue', value: ledger.buildingValue.toString() },
    { label: 'seniorLiens', value: ledger.seniorLiens.toString() },
    { label: 'safeRatioPercent', value: ledger.safeRatioPercent.toString() },
    { label: 'declaredCount', value: ledger.declaredCount.toString() },
    { label: 'revision', value: ledger.revision.toString() },
    ...slots.map(([slot, commitment]) => ({
      label: `declarations[${slot}]`,
      value: shortHex(commitment),
      emptySlot: toHex(commitment) === empty,
    })),
    { label: 'certIssued', value: String(ledger.certIssued) },
    { label: 'certNewDeposit', value: ledger.certNewDeposit.toString() },
    { label: 'certSafe', value: String(ledger.certSafe) },
    { label: 'certRevision', value: ledger.certRevision.toString() },
    { label: 'certCount', value: ledger.certCount.toString() },
  ];
};

/** JSON.stringify replacer that writes bigints as decimal strings. */
export const bigintReplacer = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const big = (source: Record<string, unknown>, field: string): bigint => {
  const raw = source[field];
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw new WireFormatError(field);
  }
  return BigInt(raw);
};

const bool = (source: Record<string, unknown>, field: string): boolean => {
  const raw = source[field];
  if (typeof raw !== 'boolean') {
    throw new WireFormatError(field);
  }
  return raw;
};

const record = (source: Record<string, unknown>, field: string): Record<string, unknown> => {
  const raw = source[field];
  if (!isRecord(raw)) {
    throw new WireFormatError(field);
  }
  return raw;
};

const array = (source: Record<string, unknown>, field: string): Record<string, unknown>[] => {
  const raw = source[field];
  if (!Array.isArray(raw) || !raw.every(isRecord)) {
    throw new WireFormatError(field);
  }
  return raw;
};

/** Parses view state produced with {@link bigintReplacer}, validating every field. */
export const decodeDerivedState = (json: unknown): SafeJeonseDerivedState => {
  if (!isRecord(json)) {
    throw new WireFormatError('state');
  }
  const building = record(json, 'building');
  const certificate = json.certificate === null ? null : record(json, 'certificate');
  const leaseCodesIssued = json.leaseCodesIssued;
  if (typeof leaseCodesIssued !== 'number' || !Number.isInteger(leaseCodesIssued) || leaseCodesIssued < 0) {
    throw new WireFormatError('leaseCodesIssued');
  }

  return {
    building: {
      buildingValue: big(building, 'buildingValue'),
      seniorLiens: big(building, 'seniorLiens'),
      safeRatioPercent: big(building, 'safeRatioPercent'),
    },
    exposureLimit: big(json, 'exposureLimit'),
    isLandlord: bool(json, 'isLandlord'),
    isRegistrar: bool(json, 'isRegistrar'),
    attested: bool(json, 'attested'),
    registerUpdates: big(json, 'registerUpdates'),
    slots: array(json, 'slots').map((slot) => ({
      slot: big(slot, 'slot'),
      occupied: bool(slot, 'occupied'),
      declaredByMe: bool(slot, 'declaredByMe'),
    })),
    declaredCount: big(json, 'declaredCount'),
    revision: big(json, 'revision'),
    certificate:
      certificate === null
        ? null
        : {
            newDeposit: big(certificate, 'newDeposit'),
            safe: bool(certificate, 'safe'),
            stale: bool(certificate, 'stale'),
            issuedAtRevision: big(certificate, 'issuedAtRevision'),
          },
    certificatesIssued: big(json, 'certificatesIssued'),
    myDeposits: array(json, 'myDeposits').map((deposit) => ({
      slot: big(deposit, 'slot'),
      amount: big(deposit, 'amount'),
    })),
    leaseCodesIssued,
  };
};
