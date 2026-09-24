// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

import { type Ledger } from "./managed/safejeonse/contract/index.js";
import { MAX_UNITS } from "./witnesses.js";

export class BuildingFullError extends Error {
  constructor() {
    super("All unit slots in this building are taken");
    this.name = "BuildingFullError";
  }
}

/** The lowest unit slot with no sealed deposit. Slots freed by tenants who moved out are reused. */
export const firstFreeSlot = (ledger: Ledger): bigint => {
  for (let slot = 0n; slot < BigInt(MAX_UNITS); slot++) {
    if (!ledger.slotOwner.member(slot)) {
      return slot;
    }
  }
  throw new BuildingFullError();
};
