// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

/**
 * Shared types for the SafeJeonse API, CLI and UI.
 *
 * @module
 */

import { type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { type FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { SafeJeonsePrivateState, Contract, Witnesses } from '../../contract/src/index';

export const safeJeonsePrivateStateKey = 'safeJeonsePrivateState';
export type PrivateStateId = typeof safeJeonsePrivateStateKey;

export type PrivateStates = {
  readonly safeJeonsePrivateState: SafeJeonsePrivateState;
};

export type SafeJeonseContract = Contract<SafeJeonsePrivateState, Witnesses<SafeJeonsePrivateState>>;

export type SafeJeonseCircuitKeys = Exclude<keyof SafeJeonseContract['impureCircuits'], number | symbol>;

export type SafeJeonseProviders = MidnightProviders<SafeJeonseCircuitKeys, PrivateStateId, SafeJeonsePrivateState>;

export type DeployedSafeJeonseContract = FoundContract<SafeJeonseContract>;

/** Figures from the official property register, attested by the registry office. All amounts in 만원. */
export type RegisterData = {
  /** Official or appraised value of the building (공시가격 / 감정가). */
  readonly buildingValue: bigint;
  /** Senior liens on the property register, e.g. mortgage 채권최고액 (등기부등본). */
  readonly seniorLiens: bigint;
};

/** Everything needed to set up a building: register figures plus the safe ratio. All amounts in 만원. */
export type BuildingRegistration = {
  /** Official or appraised value of the building (공시가격 / 감정가). */
  readonly buildingValue: bigint;
  /** Senior liens on the property register, e.g. mortgage 채권최고액 (등기부등본). */
  readonly seniorLiens: bigint;
  /** Largest share of the value that liens plus deposits may take, in percent. */
  readonly safeRatioPercent: bigint;
};

export type SlotView = {
  readonly slot: bigint;
  /** True when a tenant has declared a deposit here. The amount is never visible. */
  readonly occupied: boolean;
  /** True when the current user is the tenant who declared this slot. */
  readonly declaredByMe: boolean;
};

export type CertificateView = {
  /** Deposit the prospective tenant asked about, in 만원. */
  readonly newDeposit: bigint;
  readonly safe: boolean;
  /** True when deposits changed after the certificate was issued. */
  readonly stale: boolean;
  readonly issuedAtRevision: bigint;
};

/** What the UI and CLI render: public ledger data combined with this user's private state. */
export type SafeJeonseDerivedState = {
  readonly building: BuildingRegistration;
  /** value * ratio / 100: the most liens plus deposits the building can safely carry. */
  readonly exposureLimit: bigint;
  readonly isLandlord: boolean;
  /** True when the current user is the registry office named by this building. */
  readonly isRegistrar: boolean;
  /** False until the registry office has attested the building value and liens. */
  readonly attested: boolean;
  /** How many times the registry office has attested or updated the register data. */
  readonly registerUpdates: bigint;
  readonly slots: readonly SlotView[];
  readonly declaredCount: bigint;
  readonly revision: bigint;
  readonly certificate: CertificateView | null;
  readonly certificatesIssued: bigint;
  /** Private: deposits this user declared (only ever known locally). */
  readonly myDeposits: readonly { readonly slot: bigint; readonly amount: bigint }[];
  /** Private: number of lease codes this user created as landlord. */
  readonly leaseCodesIssued: number;
};

/** The roles the demo apps can act as. Each one keeps its own private state. */
export const PERSONA_IDS = ['landlord', 'registrar', 'tenant-a', 'tenant-b', 'renter'] as const;

export type Persona = (typeof PERSONA_IDS)[number];

export const isPersona = (value: unknown): value is Persona =>
  typeof value === 'string' && (PERSONA_IDS as readonly string[]).includes(value);
