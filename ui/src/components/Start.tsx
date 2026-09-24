// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { formatManwon } from '../../../api/src/index';
import { type BuildingManager } from '../manager';
import { parseManwon, useAction } from './useAction';

const HEX_ADDRESS = /^[0-9a-f]{64,}$/i;

export const Start: React.FC<{ manager: BuildingManager; onReady: (address: string) => void }> = ({
  manager,
  onReady,
}) => {
  const [value, setValue] = useState('50000');
  const [liens, setLiens] = useState('20000');
  const [ratio, setRatio] = useState('70');
  const [address, setAddress] = useState('');
  const [status, register] = useAction<string>();

  const buildingValue = parseManwon(value);
  const seniorLiens = liens.trim() === '' || liens.trim() === '0' ? 0n : parseManwon(liens);
  const ratioNumber = Number(ratio);
  const ratioValid = Number.isInteger(ratioNumber) && ratioNumber >= 1 && ratioNumber <= 100;
  const canRegister = buildingValue !== null && seniorLiens !== null && ratioValid && status.kind !== 'busy';

  const submit = () => {
    if (buildingValue === null || seniorLiens === null || !ratioValid) {
      return;
    }
    void register('Connecting to your wallet and deploying. This can take a minute.', async () => {
      const api = await manager.register({ buildingValue, seniorLiens, safeRatioPercent: BigInt(ratioNumber) });
      onReady(api.deployedContractAddress);
      return api.deployedContractAddress;
    });
  };

  return (
    <main className="layout">
      <section className="sheet" aria-labelledby="register-new">
        <h2 className="sheet-title" id="register-new">
          건물 등록 <span>Register a building</span>
        </h2>
        <p className="explain">
          As the landlord, enter the numbers from the public property register. Nothing private goes on-chain here.
        </p>
        <label className="field">
          <span>Building value, 공시가격 (만원)</span>
          <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
          <em>{buildingValue === null ? 'Enter a whole number' : formatManwon(buildingValue)}</em>
        </label>
        <label className="field">
          <span>Senior liens, 근저당 채권최고액 (만원)</span>
          <input inputMode="numeric" value={liens} onChange={(e) => setLiens(e.target.value)} />
          <em>{seniorLiens === null ? 'Enter a whole number, or 0' : formatManwon(seniorLiens)}</em>
        </label>
        <label className="field">
          <span>Safe ratio (%)</span>
          <input inputMode="numeric" value={ratio} onChange={(e) => setRatio(e.target.value)} />
          <em>
            {ratioValid
              ? 'Liens plus all deposits must stay under this share of the value. 70% is a common rule of thumb.'
              : 'Between 1 and 100'}
          </em>
        </label>
        <button className="btn" disabled={!canRegister} onClick={submit}>
          Register building
        </button>
        {status.kind === 'busy' && <div className="busy">{status.label}</div>}
        {status.kind === 'failed' && (
          <div className="notice error" role="alert">
            {status.message}
          </div>
        )}
      </section>

      <section className="sheet" aria-labelledby="open-existing">
        <h2 className="sheet-title" id="open-existing">
          건물 조회 <span>Open a building</span>
        </h2>
        <p className="explain">Got a SafeJeonse link or contract address from a landlord? Open it here.</p>
        <label className="field">
          <span>Contract address</span>
          <input className="code" value={address} onChange={(e) => setAddress(e.target.value.trim())} />
        </label>
        <button className="btn ghost" disabled={!HEX_ADDRESS.test(address)} onClick={() => onReady(address)}>
          Open building
        </button>
        <div className="notice" style={{ marginTop: 22 }}>
          You need the Lace wallet set to Midnight {String(import.meta.env.VITE_NETWORK_ID)}, with the proof server set
          to Local, and a little tDUST for fees.
        </div>
      </section>
    </main>
  );
};
