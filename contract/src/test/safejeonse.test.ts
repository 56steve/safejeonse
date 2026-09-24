// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { beforeEach, describe, expect, it } from "vitest";
import { pureCircuits } from "../managed/safejeonse/contract/index.js";
import {
  type DepositOpening,
  type SafeJeonsePrivateState,
  MAX_UNITS,
  createSafeJeonsePrivateState,
} from "../witnesses.js";
import { demoRegistrySecretKey } from "../registry.js";
import { SafeJeonseSimulator, rolePublicKey } from "./safejeonse-simulator.js";
import { randomBytes } from "./utils.js";

setNetworkId("undeployed");

// Amounts are in 만원 (10,000 KRW).
// Building worth 5억, mortgage 2억, safe ratio 70% -> exposure limit 3.5억.
const BUILDING = { value: 50_000n, liens: 20_000n, ratioPercent: 70n };

const opening = (amount: bigint): DepositOpening => ({
  amount,
  salt: randomBytes(32),
});

const bytesToHex = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("hex");

describe("SafeJeonse contract", () => {
  let landlordKey: Uint8Array;
  let registrarKey: Uint8Array;
  let sim: SafeJeonseSimulator;

  const registrar = (): SafeJeonsePrivateState =>
    createSafeJeonsePrivateState(registrarKey);

  const tenant = (deposit: DepositOpening): SafeJeonsePrivateState =>
    createSafeJeonsePrivateState(randomBytes(32), deposit);

  const landlord = (
    leaseBook: ReadonlyArray<DepositOpening | null>,
  ): SafeJeonsePrivateState =>
    createSafeJeonsePrivateState(landlordKey, null, leaseBook);

  const deploy = (): SafeJeonseSimulator =>
    new SafeJeonseSimulator(landlordKey, {
      ratioPercent: BUILDING.ratioPercent,
    });

  beforeEach(() => {
    landlordKey = randomBytes(32);
    registrarKey = demoRegistrySecretKey();
    sim = deploy();
    sim.as(registrar()).attestRegister(BUILDING.value, BUILDING.liens);
  });

  describe("deployment", () => {
    it("starts with no register data until the registrar attests it", () => {
      const fresh = deploy().getLedger();
      expect(fresh.attested).toBe(false);
      expect(fresh.buildingValue).toBe(0n);
    });

    it("publishes only the public register data", () => {
      const state = sim.getLedger();
      expect(state.attested).toBe(true);
      expect(state.buildingValue).toBe(BUILDING.value);
      expect(state.seniorLiens).toBe(BUILDING.liens);
      expect(state.safeRatioPercent).toBe(BUILDING.ratioPercent);
      expect(state.declaredCount).toBe(0n);
      expect(state.certIssued).toBe(false);
      expect(state.landlord).not.toEqual(landlordKey);
    });

    it("pre-fills every slot with the empty-deposit commitment", () => {
      const state = sim.getLedger();
      expect(state.declarations.size()).toBe(BigInt(MAX_UNITS));
      const empty = pureCircuits.emptyCommitment();
      for (const [, commitment] of state.declarations) {
        expect(commitment).toEqual(empty);
      }
    });

    it("rejects an out-of-range safe ratio", () => {
      expect(
        () =>
          new SafeJeonseSimulator(randomBytes(32), {
            ratioPercent: 101n,
          }),
      ).toThrow(/Safe ratio/);
    });
  });

  describe("registry office attestation", () => {
    it("embeds the official registry key in the contract", () => {
      expect(pureCircuits.officialRegistry()).toEqual(
        rolePublicKey("registrar", demoRegistrySecretKey()),
      );
    });

    it("rejects any registrar key other than the official one", () => {
      // A landlord who invents their own "registry office" gets nowhere.
      const fakeOffice = createSafeJeonsePrivateState(randomBytes(32));
      expect(() => sim.as(fakeOffice).attestRegister(90_000n, 0n)).toThrow(
        /Only the registry office/,
      );
      const landlordAsOffice = createSafeJeonsePrivateState(landlordKey);
      expect(() =>
        sim.as(landlordAsOffice).attestRegister(90_000n, 0n),
      ).toThrow(/Only the registry office/);
    });

    it("rejects register data from anyone but the registrar", () => {
      expect(() => sim.as(landlord([])).attestRegister(90_000n, 0n)).toThrow(
        /Only the registry office/,
      );
      expect(() =>
        sim.as(tenant(opening(1n))).attestRegister(90_000n, 0n),
      ).toThrow(/Only the registry office/);
      expect(sim.getLedger().buildingValue).toBe(BUILDING.value);
    });

    it("refuses to certify before the building is attested", () => {
      const fresh = deploy();
      expect(() => fresh.as(landlord([])).certify(1_000n)).toThrow(
        /has not attested/,
      );
    });

    it("rejects a zero building value", () => {
      expect(() => sim.as(registrar()).attestRegister(0n, 0n)).toThrow(
        /Building value must be positive/,
      );
    });

    it("turns a SAFE deposit RISKY when a new mortgage is registered", () => {
      const deposit = opening(10_000n);
      sim.as(tenant(deposit)).declareDeposit();
      // 20,000 + 10,000 + 5,000 = 35,000 <= 35,000
      expect(sim.as(landlord([deposit])).certify(5_000n)).toBe(true);
      const issuedAt = sim.getLedger().certRevision;

      // The landlord takes another loan: liens rise to 2억 5,000만.
      sim.as(registrar()).attestRegister(BUILDING.value, 25_000n);
      const state = sim.getLedger();
      expect(state.revision).toBeGreaterThan(issuedAt);
      expect(state.attestCount).toBe(2n);

      expect(sim.as(landlord([deposit])).certify(5_000n)).toBe(false);
    });
  });

  describe("tenant declarations", () => {
    it("stores a hiding commitment, never the deposit amount", () => {
      const deposit = opening(3_000n);
      const slot = sim.as(tenant(deposit)).declareDeposit();
      const state = sim.getLedger();

      expect(slot).toBe(0n);
      expect(state.declaredCount).toBe(1n);
      expect(state.declarations.lookup(0n)).toEqual(
        SafeJeonseSimulator.commitmentOf(deposit),
      );
      // Same amount with a different salt gives an unlinkable commitment.
      expect(state.declarations.lookup(0n)).not.toEqual(
        SafeJeonseSimulator.commitmentOf(opening(3_000n)),
      );
      expect(state.slotOwner.member(0n)).toBe(true);
    });

    it("assigns consecutive slots and refuses once the building is full", () => {
      for (let i = 0; i < MAX_UNITS; i++) {
        expect(sim.as(tenant(opening(1_000n))).declareDeposit()).toBe(
          BigInt(i),
        );
      }
      expect(() => sim.as(tenant(opening(1_000n))).declareDeposit()).toThrow(
        /All unit slots/,
      );
    });

    it("rejects a zero deposit", () => {
      expect(() => sim.as(tenant(opening(0n))).declareDeposit()).toThrow(
        /Deposit must be positive/,
      );
    });

    it("lets only the declaring tenant withdraw", () => {
      const alice = tenant(opening(3_000n));
      sim.as(alice).declareDeposit();

      expect(() => sim.as(tenant(opening(1n))).withdrawDeposit(0n)).toThrow(
        /Only the declaring tenant/,
      );
      expect(() => sim.as(landlord([])).withdrawDeposit(0n)).toThrow(
        /Only the declaring tenant/,
      );

      sim.as(alice).withdrawDeposit(0n);
      const state = sim.getLedger();
      expect(state.slotOwner.member(0n)).toBe(false);
      expect(state.declarations.lookup(0n)).toEqual(
        pureCircuits.emptyCommitment(),
      );
    });
  });

  describe("safety certificate", () => {
    let leaseBook: DepositOpening[];

    beforeEach(() => {
      // Two existing tenants: 3,000만 + 4,000만 = 7,000만 of senior deposits.
      leaseBook = [opening(3_000n), opening(4_000n)];
      for (const deposit of leaseBook) {
        sim.as(tenant(deposit)).declareDeposit();
      }
    });

    it("certifies SAFE when liens + deposits + new deposit fit the limit", () => {
      // 20,000 + 7,000 + 8,000 = 35,000 <= 35,000 (boundary)
      expect(sim.as(landlord(leaseBook)).certify(8_000n)).toBe(true);
      const state = sim.getLedger();
      expect(state.certIssued).toBe(true);
      expect(state.certSafe).toBe(true);
      expect(state.certNewDeposit).toBe(8_000n);
      expect(state.certRevision).toBe(state.revision);
    });

    it("certifies RISKY when the new deposit would exceed the limit", () => {
      // 20,000 + 7,000 + 8,001 = 35,001 > 35,000
      expect(sim.as(landlord(leaseBook)).certify(8_001n)).toBe(false);
      expect(sim.getLedger().certSafe).toBe(false);
    });

    it("never publishes individual or total senior deposits", () => {
      sim.as(landlord(leaseBook)).certify(5_000n);
      const state = sim.getLedger();
      const publicNumbers = [
        state.buildingValue,
        state.seniorLiens,
        state.safeRatioPercent,
        state.certNewDeposit,
        state.declaredCount,
        state.revision,
        state.certRevision,
        state.certCount,
      ];
      for (const secret of [3_000n, 4_000n, 7_000n]) {
        expect(publicNumbers).not.toContain(secret);
      }
    });

    it("rejects a landlord who under-reports a tenant's deposit", () => {
      const forged = [{ ...leaseBook[0], amount: 1_000n }, leaseBook[1]];
      expect(() => sim.as(landlord(forged)).certify(8_000n)).toThrow(
        /do not match the on-chain declarations/,
      );
    });

    it("rejects a landlord who hides a tenant entirely", () => {
      expect(() => sim.as(landlord([leaseBook[0]])).certify(8_000n)).toThrow(
        /do not match the on-chain declarations/,
      );
    });

    it("rejects certification by anyone other than the landlord", () => {
      const impostor = createSafeJeonsePrivateState(
        randomBytes(32),
        null,
        leaseBook,
      );
      expect(() => sim.as(impostor).certify(1_000n)).toThrow(
        /Only the registered landlord/,
      );
    });

    it("marks an old certificate stale after declarations change", () => {
      sim.as(landlord(leaseBook)).certify(5_000n);
      const certRevision = sim.getLedger().certRevision;
      sim.as(tenant(opening(2_000n))).declareDeposit();
      expect(sim.getLedger().revision).toBeGreaterThan(certRevision);
    });

    it("counts a new tenant and releases them after they move out", () => {
      const carolDeposit = opening(9_000n);
      const carol = tenant(carolDeposit);
      expect(sim.as(carol).declareDeposit()).toBe(2n);

      // With Carol's 9,000만 counted, an extra 8,000만 is RISKY.
      expect(
        sim.as(landlord([...leaseBook, carolDeposit])).certify(8_000n),
      ).toBe(false);

      // Carol's deposit is returned; she withdraws her declaration.
      sim.as(carol).withdrawDeposit(2n);
      expect(bytesToHex(sim.getLedger().declarations.lookup(2n))).toBe(
        bytesToHex(pureCircuits.emptyCommitment()),
      );
      expect(sim.as(landlord(leaseBook)).certify(8_000n)).toBe(true);
    });
  });
});
