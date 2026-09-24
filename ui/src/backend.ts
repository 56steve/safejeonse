// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

import { type Observable } from 'rxjs';
import {
  type BuildingRegistration,
  type LedgerRow,
  type Persona,
  type RegisterData,
  type SafeJeonseDerivedState,
} from '../../api/src/index';

export type { Persona };

/** One building, seen by one persona. */
export interface BuildingSession {
  readonly state$: Observable<SafeJeonseDerivedState>;
  createLeaseCode(amount: bigint): Promise<string>;
  declareDeposit(leaseCode: string): Promise<bigint>;
  withdrawDeposit(slot: bigint): Promise<void>;
  certify(newDeposit: bigint): Promise<boolean>;
  attestRegister(data: RegisterData): Promise<void>;
  ledgerRows(): Promise<LedgerRow[]>;
}

/** Where proofs are built and transactions submitted: the Lace wallet, or the local demo server. */
export interface Backend {
  readonly kind: 'lace' | 'local';
  /** Deploys a new building contract and returns its address. */
  register(registration: BuildingRegistration): Promise<string>;
  open(address: string): void;
  as(persona: Persona): Promise<BuildingSession>;
}

export const PERSONAS: ReadonlyArray<{ id: Persona; label: string; hint: string }> = [
  { id: 'landlord', label: '임대인 Landlord', hint: 'Owns the building, issues lease codes and certificates' },
  { id: 'registrar', label: '등기소 Registry office', hint: 'The only party that can set value and mortgage' },
  { id: 'tenant-a', label: '임차인 A Tenant', hint: 'Already lives here and has paid a deposit' },
  { id: 'tenant-b', label: '임차인 B Tenant', hint: 'Another existing tenant' },
  { id: 'renter', label: '예비 임차인 Renter', hint: 'Deciding whether to sign' },
];
