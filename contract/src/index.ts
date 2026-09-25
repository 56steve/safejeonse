// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";

export * from "./managed/safejeonse/contract/index.js";
export * from "./witnesses";
export * from "./registry";
export * from "./slots";

import * as CompiledSafeJeonse from "./managed/safejeonse/contract/index.js";
import * as Witnesses from "./witnesses";

export const CompiledSafeJeonseContract = CompiledContract.make<
  CompiledSafeJeonse.Contract<Witnesses.SafeJeonsePrivateState>
>(
  "SafeJeonse",
  CompiledSafeJeonse.Contract<Witnesses.SafeJeonsePrivateState>,
).pipe(
  CompiledContract.withWitnesses(Witnesses.witnesses),
  CompiledContract.withCompiledFileAssets("./managed/safejeonse"),
);
