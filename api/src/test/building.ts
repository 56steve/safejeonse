// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

import { SafeJeonseSimulator, rolePublicKey } from '../../../contract/src/test/safejeonse-simulator.js';
import { createSafeJeonsePrivateState } from '../../../contract/src/witnesses.js';
import { randomBytes } from '../utils/index.js';

/** Deploys a simulated building worth 5억 with a 2억 mortgage and a 70% ratio, attested by a registrar. */
export const attestedBuilding = (landlordKey: Uint8Array, registrarKey: Uint8Array = randomBytes(32)) => {
  const sim = new SafeJeonseSimulator(landlordKey, {
    registrarPublicKey: rolePublicKey('registrar', registrarKey),
    ratioPercent: 70n,
  });
  sim.as(createSafeJeonsePrivateState(registrarKey)).attestRegister(50_000n, 20_000n);
  return sim;
};
