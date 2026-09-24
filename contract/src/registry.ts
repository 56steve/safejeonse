// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

/*
 * Secret key of the demo registry office (등기소).
 *
 * The contract only accepts register data signed off by the key returned by
 * `officialRegistry()`, which is derived from this secret. It is published on
 * purpose, like the genesis wallet seed of a local Midnight network, so the demo
 * apps can play the registry office. A production build would embed the real
 * office's public key in the contract, and the office alone would hold the secret.
 */

const DEMO_REGISTRY_SECRET_HEX =
  "342ea2dec4e4af9066c1c18f924f3bef48b34db7e470db8dfd4de6d5f795b6f3";

export const demoRegistrySecretKey = (): Uint8Array =>
  Uint8Array.from(DEMO_REGISTRY_SECRET_HEX.match(/../g) ?? [], (byte) =>
    parseInt(byte, 16),
  );
