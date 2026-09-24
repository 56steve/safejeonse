// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { type SafeJeonseDerivedState, formatManwon } from '../../../api/src/index';

/** The public "property register" view. Everything shown here is readable by anyone on-chain. */
export const Register: React.FC<{ state: SafeJeonseDerivedState; address: string }> = ({ state, address }) => {
  const { building } = state;
  const occupied = state.slots.filter((slot) => slot.occupied).length;

  return (
    <section className="sheet" aria-labelledby="register-title">
      <h2 className="sheet-title" id="register-title">
        건물 공개 정보 <span>Public register</span>
      </h2>
      <table className="register">
        <tbody>
          <tr>
            <th>
              건물 가액
              <span className="note">Building value (공시가격)</span>
            </th>
            <td className="num">{formatManwon(building.buildingValue)}</td>
          </tr>
          <tr>
            <th>
              선순위 근저당
              <span className="note">Senior liens on the register</span>
            </th>
            <td className="num">{formatManwon(building.seniorLiens)}</td>
          </tr>
          <tr>
            <th>
              안전 한도
              <span className="note">{building.safeRatioPercent.toString()}% of value</span>
            </th>
            <td className="num">{formatManwon(state.exposureLimit)}</td>
          </tr>
          <tr>
            <th>
              선순위 보증금
              <span className="note">Deposits already owed to tenants</span>
            </th>
            <td>
              <strong>{occupied}</strong> sealed {occupied === 1 ? 'deposit' : 'deposits'}. Amounts are hidden.
            </td>
          </tr>
        </tbody>
      </table>

      <div className="slots" role="list" aria-label="Unit slots">
        {state.slots.map((slot) => (
          <div
            key={slot.slot.toString()}
            role="listitem"
            className={`slot${slot.occupied ? ' occupied' : ''}${slot.declaredByMe ? ' mine' : ''}`}
            aria-label={`Slot ${slot.slot}: ${slot.occupied ? 'sealed deposit' : 'empty'}${slot.declaredByMe ? ', yours' : ''}`}
          >
            <span className="slot-no">{slot.slot.toString().padStart(2, '0')}</span>
            {!slot.occupied && <span>empty</span>}
            {slot.declaredByMe && <span className="slot-tag">mine</span>}
          </div>
        ))}
      </div>

      <Certificate state={state} />

      <p className="address" style={{ marginTop: 16 }}>
        Contract {address}
      </p>
    </section>
  );
};

const Certificate: React.FC<{ state: SafeJeonseDerivedState }> = ({ state }) => {
  const cert = state.certificate;
  if (cert === null) {
    return (
      <div className="certificate">
        <h3>안전 증명서 · CERTIFICATE</h3>
        <p>No certificate yet. The landlord issues one for a specific deposit amount.</p>
      </div>
    );
  }
  return (
    <div className={`certificate${cert.stale ? ' stale' : ''}`} aria-live="polite">
      <h3>안전 증명서 · CERTIFICATE</h3>
      <p>
        For a new deposit of <strong>{formatManwon(cert.newDeposit)}</strong>, liens plus every sealed deposit plus this
        one {cert.safe ? 'stay within' : 'go over'} the {state.building.safeRatioPercent.toString()}% limit.
      </p>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
        Proven with zero knowledge. Certificate #{state.certificatesIssued.toString()}
        {cert.stale ? '. Out of date: deposits changed after it was issued.' : '.'}
      </p>
      <div
        key={`${state.certificatesIssued}`}
        className={`seal ${cert.safe ? 'safe' : 'risk'}`}
        role="img"
        aria-label={cert.safe ? 'Safe' : 'Risky'}
      >
        <span>
          <b>{cert.safe ? '안전' : '위험'}</b>
          <i>{cert.safe ? 'SAFE' : 'RISKY'}</i>
        </span>
      </div>
    </div>
  );
};
