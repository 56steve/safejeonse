// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

/*
 * A scripted walk-through of SafeJeonse on a real (local) Midnight network,
 * with real zero-knowledge proofs. Every step below is an actual transaction.
 *
 * The story (amounts in 만원):
 *   Landlord Kim owns a small 다가구 building worth 5억 with a 2억 mortgage,
 *   as attested by the registry office (등기소).
 *   Tenants Park (8,000만) and Lee (5,000만) already live there.
 *   Choi is offered a unit for a 7,000만 jeonse deposit and wants to know if it is safe.
 */

import { SafeJeonseAPI, decodeLeaseCode, formatManwon, resolveLeaseBook } from '../../api/src/index';
import { type Session } from './index.js';
import {
  bold,
  dim,
  green,
  heading,
  printBlock,
  red,
  renderBuilding,
  renderRawLedger,
  say,
  verdictText,
} from './view.js';

const BUILDING = { buildingValue: 50_000n, seniorLiens: 20_000n, safeRatioPercent: 70n };
const PARK_DEPOSIT = 8_000n;
const LEE_DEPOSIT = 5_000n;
const CHOI_OFFER = 7_000n;
const NEW_LIENS = 25_000n;

const circuitReason = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('failed assert: ') ? (message.split('failed assert: ').pop() ?? message) : message;
};

const step = async <T>(label: string, action: () => Promise<T>): Promise<T> => {
  const started = Date.now();
  const live = process.stdout.isTTY;
  if (live) {
    process.stdout.write(`  ${dim('…')} ${label}`);
  }
  const result = await action();
  const done = `  ${green('✓')} ${label} ${dim(`(${((Date.now() - started) / 1000).toFixed(1)}s)`)}\n`;
  process.stdout.write(live ? `\r\x1b[2K${done}` : done);
  return result;
};

export const demoStory = async (session: Session): Promise<void> => {
  const quiet = session.logger.child({}, { level: 'warn' });
  const as = (persona: string, address: string) => SafeJeonseAPI.join(session.providers(persona), address, quiet);

  heading('1. Kim registers the building, the registry office attests it');
  say('  Kim deploys the contract but cannot set its numbers. Only the official registry office can,');
  say('  and its key is fixed inside the contract, so Kim cannot name an office of his own:');
  say(`  value ${formatManwon(BUILDING.buildingValue)}, mortgage ${formatManwon(BUILDING.seniorLiens)}.`);
  const kim = await step('Kim deploys the SafeJeonse contract', () =>
    SafeJeonseAPI.deploy(session.providers('landlord'), { safeRatioPercent: BUILDING.safeRatioPercent }, quiet),
  );
  const address = kim.deployedContractAddress;
  const registry = await SafeJeonseAPI.join(session.providers('registrar'), address, quiet, session.registrarSecretKey);
  await step('The registry office attests the register figures', () => registry.attestRegister(BUILDING));
  say(`  Contract address: ${bold(address)}`);

  heading('2. Existing tenants lock in their deposits');
  say('  Kim hands each tenant a lease code. Each tenant checks the amount against');
  say('  their paper lease and declares it. Only a salted hash goes on-chain.');
  const parkCode = await kim.createLeaseCode(PARK_DEPOSIT);
  const leeCode = await kim.createLeaseCode(LEE_DEPOSIT);
  const park = await as('tenant-park', address);
  const lee = await as('tenant-lee', address);
  const parkSlot = await step(`Park declares ${formatManwon(PARK_DEPOSIT)} (ZK proof)`, () =>
    park.declareDeposit(parkCode),
  );
  const leeSlot = await step(`Lee declares ${formatManwon(LEE_DEPOSIT)} (ZK proof)`, () => lee.declareDeposit(leeCode));
  say(`  Park is in slot ${parkSlot}, Lee is in slot ${leeSlot}.`);

  heading('3. Choi asks: is a 7,000만 deposit safe here?');
  say(`  Kim says "Don't worry, it's safe." Choi asks for a SafeJeonse certificate instead.`);
  const choi = await as('renter-choi', address);
  const firstVerdict = await step('Kim proves the verdict over every declared deposit', () => kim.certify(CHOI_OFFER));
  const choiView = await choi.currentState();
  say();
  say(`  What Choi sees:`);
  printBlock(renderBuilding(choiView).map((line) => `  ${line}`));
  say();
  say(`  Verdict for ${formatManwon(CHOI_OFFER)}: ${verdictText(firstVerdict)}`);
  say(dim(`  Choi learns the building can't safely take this deposit, without ever seeing`));
  say(dim(`  how much Park or Lee paid.`));

  heading('4. A dishonest landlord tries to cheat');
  say(`  Kim skips the app and feeds the circuit a forged record: Park "only" paid 1,000만.`);
  const honestBook = resolveLeaseBook((await kim.queryLedger()).declarations, [
    decodeLeaseCode(parkCode),
    decodeLeaseCode(leeCode),
  ]);
  const forgedBook = honestBook.map((entry, slot) =>
    BigInt(slot) === parkSlot && entry !== null ? { ...entry, amount: 1_000n } : entry,
  );
  try {
    await kim.certifyWithLeaseBook(CHOI_OFFER, forgedBook);
    say(red('  Unexpected: the forged certificate went through.'));
    process.exitCode = 1;
  } catch (error) {
    say(`  ${green('✓')} The circuit refused: "${circuitReason(error)}"`);
    say(dim(`  Park's commitment on-chain doesn't match 1,000만, so no valid proof exists.`));
  }
  say(`  Kim then tries to inflate the building value to 9억 himself.`);
  try {
    await kim.attestRegister({ buildingValue: 90_000n, seniorLiens: BUILDING.seniorLiens });
    say(red('  Unexpected: the landlord changed the register data.'));
    process.exitCode = 1;
  } catch (error) {
    say(`  ${green('✓')} The circuit refused: "${circuitReason(error)}"`);
  }

  heading('5. Lee moves out and gets her deposit back');
  await step(`Lee withdraws her declaration from slot ${leeSlot}`, () => lee.withdrawDeposit(leeSlot));
  const staleView = await choi.currentState();
  say(
    `  The old certificate is now marked out of date: ${staleView.certificate?.stale === true ? green('yes') : red('no')}`,
  );
  const secondVerdict = await step('Kim proves the verdict again', () => kim.certify(CHOI_OFFER));
  say(`  Verdict for ${formatManwon(CHOI_OFFER)}: ${verdictText(secondVerdict)}`);

  heading('6. Kim takes out a new loan');
  say('  Days before Choi moves in, Kim quietly borrows more against the building: the');
  say(`  mortgage rises to ${formatManwon(NEW_LIENS)}. The registry office records it on-chain.`);
  await step('The registry office records the new mortgage', () =>
    registry.attestRegister({ buildingValue: BUILDING.buildingValue, seniorLiens: NEW_LIENS }),
  );
  const afterLoan = await choi.currentState();
  say(
    `  Choi's certificate is now marked out of date: ${afterLoan.certificate?.stale === true ? green('yes') : red('no')}`,
  );
  const thirdVerdict = await step('Kim proves the verdict with the new mortgage', () => kim.certify(CHOI_OFFER));
  say(`  Verdict for ${formatManwon(CHOI_OFFER)}: ${verdictText(thirdVerdict)}`);
  say(dim('  A new loan between signing and move-in is a classic jeonse fraud move. Here it shows at once.'));

  heading('7. What is actually stored on-chain');
  say('  This is everything anyone can read from the contract. Look for 8000 or 5000:');
  printBlock(renderRawLedger(await choi.queryLedger()));
  say();
  say(bold('  No individual deposit appears anywhere. Only commitments and the verdict.'));
  say();
};
