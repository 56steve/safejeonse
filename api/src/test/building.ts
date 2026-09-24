// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

import { demoRegistrySecretKey } from '../../../contract/src/registry.js';
import { SafeJeonseSimulator } from '../../../contract/src/test/safejeonse-simulator.js';
import { createSafeJeonsePrivateState } from '../../../contract/src/witnesses.js';

/** Deploys a simulated building worth 5억 with a 2억 mortgage and a 70% ratio, attested by the registry office. */
export const attestedBuilding = (landlordKey: Uint8Array) => {
  const sim = new SafeJeonseSimulator(landlordKey, { ratioPercent: 70n });
  sim.as(createSafeJeonsePrivateState(demoRegistrySecretKey())).attestRegister(50_000n, 20_000n);
  return sim;
};
