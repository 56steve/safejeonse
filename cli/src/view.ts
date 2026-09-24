// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

/* Plain-text rendering of SafeJeonse state for the terminal. */

import { type SafeJeonseDerivedState, formatManwon } from '../../api/src/index';
import { type Ledger, pureCircuits } from '../../contract/src/managed/safejeonse/contract/index.js';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const paint = (code: number) => (text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);

export const bold = paint(1);
export const dim = paint(2);
export const green = paint(32);
export const red = paint(31);
export const yellow = paint(33);
export const cyan = paint(36);

export const say = (text = ''): void => {
  process.stdout.write(`${text}\n`);
};

export const heading = (text: string): void => {
  say();
  say(bold(cyan(`── ${text} `.padEnd(64, '─'))));
};

export const verdictText = (safe: boolean): string => (safe ? green(bold('SAFE ✅')) : red(bold('RISKY ⚠️')));

export const renderBuilding = (state: SafeJeonseDerivedState): string[] => {
  const { building } = state;
  const lines = [
    `Building value (공시가격)   ${formatManwon(building.buildingValue)}`,
    `Senior liens (근저당)       ${formatManwon(building.seniorLiens)}`,
    `Safe ratio                  ${building.safeRatioPercent}% of value = ${formatManwon(state.exposureLimit)}`,
    `Units with a deposit        ${state.slots.filter((s) => s.occupied).length} of ${state.slots.length}`,
  ];
  const slotRow = state.slots
    .map((s) => (s.declaredByMe ? green('[me]') : s.occupied ? yellow('[##]') : dim('[  ]')))
    .join(' ');
  lines.push(`Slots                       ${slotRow}`);
  if (state.certificate === null) {
    lines.push('Latest certificate          none yet');
  } else {
    const cert = state.certificate;
    lines.push(
      `Latest certificate          ${formatManwon(cert.newDeposit)} → ${verdictText(cert.safe)}${cert.stale ? yellow('  (out of date: deposits changed since)') : ''}`,
    );
  }
  return lines;
};

export const renderPrivate = (state: SafeJeonseDerivedState): string[] => {
  const lines: string[] = [];
  if (state.isLandlord) {
    lines.push(`You are the landlord. Lease codes you have issued: ${state.leaseCodesIssued}`);
  }
  for (const deposit of state.myDeposits) {
    lines.push(`Your deposit in slot ${deposit.slot}: ${formatManwon(deposit.amount)} (only you can see this)`);
  }
  if (lines.length === 0) {
    lines.push('You have no private data for this building yet.');
  }
  return lines;
};

/** Everything stored on-chain, printed raw, to show that no deposit amount is in it. */
export const renderRawLedger = (ledger: Ledger): string[] => {
  const short = (bytes: Uint8Array) => `${toHex(bytes).slice(0, 16)}…`;
  const lines = [
    `landlord          ${short(ledger.landlord)}`,
    `buildingValue     ${ledger.buildingValue}`,
    `seniorLiens       ${ledger.seniorLiens}`,
    `safeRatioPercent  ${ledger.safeRatioPercent}`,
    `declaredCount     ${ledger.declaredCount}`,
    `revision          ${ledger.revision}`,
  ];
  const empty = toHex(pureCircuits.emptyCommitment());
  const slots = Array.from(ledger.declarations).sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [slot, commitment] of slots) {
    const label = toHex(commitment) === empty ? dim('  (empty slot)') : '';
    lines.push(`declarations[${slot}]   ${short(commitment)}${label}`);
  }
  lines.push(
    `certIssued        ${ledger.certIssued}`,
    `certNewDeposit    ${ledger.certNewDeposit}`,
    `certSafe          ${ledger.certSafe}`,
    `certRevision      ${ledger.certRevision}`,
    `certCount         ${ledger.certCount}`,
  );
  return lines;
};

export const printBlock = (lines: string[]): void => {
  for (const line of lines) {
    say(`  ${line}`);
  }
};
