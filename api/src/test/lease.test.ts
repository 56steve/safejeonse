// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { pureCircuits } from '../../../contract/src/managed/safejeonse/contract/index.js';
import {
  InvalidLeaseCodeError,
  UnknownDeclarationError,
  decodeLeaseCode,
  encodeLeaseCode,
  exposureLimit,
  formatManwon,
  newOpening,
  resolveLeaseBook,
} from '../lease.js';
import { randomBytes } from '../utils/index.js';

const emptySlots = (): [bigint, Uint8Array][] =>
  Array.from({ length: 8 }, (_, i) => [BigInt(i), pureCircuits.emptyCommitment()]);

describe('lease codes', () => {
  it('round-trips an opening', () => {
    const opening = newOpening(3_000n, randomBytes);
    const code = encodeLeaseCode(opening);
    expect(code).toMatch(/^SJ1-3000-[0-9a-f]{64}$/);
    expect(decodeLeaseCode(code)).toEqual(opening);
  });

  it('accepts surrounding whitespace and upper-case hex', () => {
    const opening = newOpening(12_345n, randomBytes);
    const code = encodeLeaseCode(opening).toUpperCase();
    expect(decodeLeaseCode(`  ${code}\n`)).toEqual(opening);
  });

  it.each([
    ['', 'format'],
    ['SJ2-100-' + '0'.repeat(64), 'format'],
    ['SJ1-abc-' + '0'.repeat(64), 'whole number'],
    ['SJ1-0-' + '0'.repeat(64), 'between 1'],
    ['SJ1-100-' + '0'.repeat(63), 'hex characters'],
    ['SJ1-100-' + 'z'.repeat(64), 'hex characters'],
  ])('rejects %j', (code, reason) => {
    expect(() => decodeLeaseCode(code)).toThrow(InvalidLeaseCodeError);
    expect(() => decodeLeaseCode(code)).toThrow(reason);
  });

  it('refuses to create a zero deposit', () => {
    expect(() => newOpening(0n, randomBytes)).toThrow(RangeError);
  });
});

describe('resolveLeaseBook', () => {
  it('places each known lease in the slot where the tenant declared it', () => {
    const a = newOpening(3_000n, randomBytes);
    const b = newOpening(4_000n, randomBytes);
    const slots = emptySlots();
    slots[0] = [0n, pureCircuits.depositCommitment(b)];
    slots[3] = [3n, pureCircuits.depositCommitment(a)];

    const book = resolveLeaseBook(slots, [a, b]);

    expect(book).toHaveLength(8);
    expect(book[0]).toEqual(b);
    expect(book[3]).toEqual(a);
    expect(book.filter((entry) => entry !== null)).toHaveLength(2);
  });

  it('ignores lease codes that were never declared', () => {
    const undeclared = newOpening(5_000n, randomBytes);
    expect(resolveLeaseBook(emptySlots(), [undeclared]).every((e) => e === null)).toBe(true);
  });

  it('refuses to continue when a slot holds an unknown deposit', () => {
    const stranger = newOpening(9_000n, randomBytes);
    const slots = emptySlots();
    slots[5] = [5n, pureCircuits.depositCommitment(stranger)];

    expect(() => resolveLeaseBook(slots, [])).toThrow(UnknownDeclarationError);
    try {
      resolveLeaseBook(slots, []);
    } catch (error) {
      expect((error as UnknownDeclarationError).slots).toEqual([5n]);
    }
  });
});

describe('number helpers', () => {
  it('computes the exposure limit', () => {
    expect(exposureLimit(50_000n, 70n)).toBe(35_000n);
  });

  it.each([
    [500n, '500만원'],
    [10_000n, '1억원'],
    [35_000n, '3억 5,000만원'],
    [123_456n, '12억 3,456만원'],
  ])('formats %s as %s', (amount, text) => {
    expect(formatManwon(amount)).toBe(text);
  });
});
