// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

/*
 * Private state and witness implementations for the SafeJeonse contract.
 *
 * Nothing in this file is ever published on-chain. Witness values are only
 * used locally to build zero-knowledge proofs.
 */

import {
  type DepositOpening,
  type Ledger,
} from "./managed/safejeonse/contract/index.js";
import { type WitnessContext } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";

export type { DepositOpening };

/** Number of unit slots per building. Must match `maxUnits()` in the contract. */
export const MAX_UNITS = 8;

/** Opening used for slots that hold no deposit (matches `emptyCommitment()`). */
export const EMPTY_OPENING: DepositOpening = Object.freeze({
  amount: 0n,
  salt: new Uint8Array(32),
});

export type SafeJeonsePrivateState = {
  /** Secret key from which this user's landlord / tenant public keys are derived. */
  readonly secretKey: Uint8Array;
  /** Tenant role: the deposit this user is about to declare. */
  readonly ownDeposit: DepositOpening | null;
  /**
   * Landlord role: deposit openings per slot, as agreed in each lease contract.
   * Missing entries are treated as empty slots.
   */
  readonly leaseBook: ReadonlyArray<DepositOpening | null>;
};

export const createSafeJeonsePrivateState = (
  secretKey: Uint8Array,
  ownDeposit: DepositOpening | null = null,
  leaseBook: ReadonlyArray<DepositOpening | null> = [],
): SafeJeonsePrivateState => {
  if (secretKey.length !== 32) {
    throw new RangeError(
      `Secret key must be 32 bytes, received ${secretKey.length}`,
    );
  }
  if (leaseBook.length > MAX_UNITS) {
    throw new RangeError(
      `Lease book holds ${leaseBook.length} entries but a building has at most ${MAX_UNITS} slots`,
    );
  }
  return { secretKey, ownDeposit, leaseBook };
};

/** Expands a (possibly sparse) lease book into exactly MAX_UNITS openings. */
export const toSlotOpenings = (
  leaseBook: ReadonlyArray<DepositOpening | null>,
): DepositOpening[] =>
  Array.from(
    { length: MAX_UNITS },
    (_, slot) => leaseBook[slot] ?? EMPTY_OPENING,
  );

export const witnesses = {
  localSecretKey: ({
    privateState,
  }: WitnessContext<Ledger, SafeJeonsePrivateState>): [
    SafeJeonsePrivateState,
    Uint8Array,
  ] => [privateState, privateState.secretKey],

  ownDeposit: ({
    privateState,
  }: WitnessContext<Ledger, SafeJeonsePrivateState>): [
    SafeJeonsePrivateState,
    DepositOpening,
  ] => {
    if (privateState.ownDeposit === null) {
      throw new Error(
        "No deposit to declare: set ownDeposit in the private state first",
      );
    }
    return [privateState, privateState.ownDeposit];
  },

  allDeposits: ({
    privateState,
  }: WitnessContext<Ledger, SafeJeonsePrivateState>): [
    SafeJeonsePrivateState,
    DepositOpening[],
  ] => [privateState, toSlotOpenings(privateState.leaseBook)],
};
