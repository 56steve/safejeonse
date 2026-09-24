// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

/**
 * Pure helpers for lease codes and for matching a landlord's leases to the
 * on-chain deposit slots. No network access happens here.
 *
 * @module
 */

import { pureCircuits } from '../../contract/src/managed/safejeonse/contract/index.js';
import { type DepositOpening, MAX_UNITS } from '../../contract/src/witnesses.js';

const LEASE_CODE_PREFIX = 'SJ1';
const SALT_HEX_LENGTH = 64;
const MAX_UINT64 = (1n << 64n) - 1n;

export class InvalidLeaseCodeError extends Error {
  constructor(reason: string) {
    super(`Invalid lease code: ${reason}`);
    this.name = 'InvalidLeaseCodeError';
  }
}

/**
 * Thrown when a slot holds a declaration the landlord has no lease code for.
 * The landlord cannot prove anything about that building until it is resolved,
 * which is the safe failure mode: an unknown deposit never counts as zero.
 */
export class UnknownDeclarationError extends Error {
  constructor(readonly slots: readonly bigint[]) {
    super(
      `Slot${slots.length > 1 ? 's' : ''} ${slots.join(', ')} hold${slots.length > 1 ? '' : 's'} a deposit you have no lease code for, so a certificate can't be issued.`,
    );
    this.name = 'UnknownDeclarationError';
  }
}

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const fromHex = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

export const assertValidAmount = (amount: bigint): void => {
  if (amount <= 0n || amount > MAX_UINT64) {
    throw new RangeError(`Amount must be between 1 and ${MAX_UINT64} (만원), received ${amount}`);
  }
};

/** Creates a fresh deposit opening with a random 32-byte salt. */
export const newOpening = (amount: bigint, randomBytes: (length: number) => Uint8Array): DepositOpening => {
  assertValidAmount(amount);
  return { amount, salt: randomBytes(32) };
};

/** Encodes an opening as a code the landlord hands to the tenant, e.g. `SJ1-3000-<64 hex chars>`. */
export const encodeLeaseCode = (opening: DepositOpening): string => {
  assertValidAmount(opening.amount);
  if (opening.salt.length !== 32) {
    throw new InvalidLeaseCodeError('salt must be 32 bytes');
  }
  return `${LEASE_CODE_PREFIX}-${opening.amount}-${toHex(opening.salt)}`;
};

export const decodeLeaseCode = (code: string): DepositOpening => {
  const parts = code.trim().split('-');
  if (parts.length !== 3 || parts[0] !== LEASE_CODE_PREFIX) {
    throw new InvalidLeaseCodeError(`expected the format ${LEASE_CODE_PREFIX}-<amount>-<salt>`);
  }
  const [, amountText, saltHex] = parts;
  if (!/^\d+$/.test(amountText)) {
    throw new InvalidLeaseCodeError('the amount must be a whole number');
  }
  if (saltHex.length !== SALT_HEX_LENGTH || !/^[0-9a-f]+$/i.test(saltHex)) {
    throw new InvalidLeaseCodeError(`the salt must be ${SALT_HEX_LENGTH} hex characters`);
  }
  const amount = BigInt(amountText);
  try {
    assertValidAmount(amount);
  } catch (error) {
    throw new InvalidLeaseCodeError(error instanceof Error ? error.message : String(error));
  }
  return { amount, salt: fromHex(saltHex.toLowerCase()) };
};

export const commitmentHex = (opening: DepositOpening): string => toHex(pureCircuits.depositCommitment(opening));

export const EMPTY_COMMITMENT_HEX = toHex(pureCircuits.emptyCommitment());

/**
 * Lines up the landlord's lease codes with the on-chain slots.
 *
 * @param declarations `[slot, commitment]` pairs read from the ledger.
 * @param issuedLeases Every lease code the landlord has handed out.
 * @returns One entry per slot: the matching opening, or `null` for an empty slot.
 * @throws UnknownDeclarationError if any non-empty slot has no matching lease code.
 */
export const resolveLeaseBook = (
  declarations: Iterable<readonly [bigint, Uint8Array]>,
  issuedLeases: readonly DepositOpening[],
): (DepositOpening | null)[] => {
  const byCommitment = new Map(issuedLeases.map((opening) => [commitmentHex(opening), opening]));
  const book: (DepositOpening | null)[] = Array.from({ length: MAX_UNITS }, () => null);
  const unknown: bigint[] = [];

  for (const [slot, commitment] of declarations) {
    const hex = toHex(commitment);
    if (hex === EMPTY_COMMITMENT_HEX) {
      continue;
    }
    const opening = byCommitment.get(hex);
    if (opening === undefined) {
      unknown.push(slot);
    } else {
      book[Number(slot)] = opening;
    }
  }

  if (unknown.length > 0) {
    throw new UnknownDeclarationError(unknown.sort((a, b) => (a < b ? -1 : 1)));
  }
  return book;
};

/** The largest total the building can carry: value * ratio / 100, in 만원. */
export const exposureLimit = (buildingValue: bigint, safeRatioPercent: bigint): bigint =>
  (buildingValue * safeRatioPercent) / 100n;

/** Formats an amount in 만원 the way Korean listings do, e.g. 35000 -> "3억 5,000만원". */
export const formatManwon = (amount: bigint): string => {
  const eok = amount / 10_000n;
  const man = amount % 10_000n;
  const manText = man.toLocaleString('en-US');
  if (eok === 0n) {
    return `${manText}만원`;
  }
  return man === 0n ? `${eok}억원` : `${eok}억 ${manText}만원`;
};
