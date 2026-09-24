// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

import React, { useMemo, useState } from 'react';
import { type SafeJeonseDerivedState, decodeLeaseCode, formatManwon } from '../../../api/src/index';
import { type BuildingSession } from '../backend';
import { type ActionStatus, errorMessage, parseManwon, useAction } from './useAction';

const Status: React.FC<{ status: ActionStatus<unknown>; done?: React.ReactNode; neutral?: boolean }> = ({
  status,
  done,
  neutral = false,
}) => {
  switch (status.kind) {
    case 'busy':
      return (
        <div className="busy" role="status">
          {status.label}
        </div>
      );
    case 'failed':
      return (
        <div className="notice error" role="alert">
          {status.message}
        </div>
      );
    case 'done':
      return done === undefined ? null : <div className={neutral ? 'notice' : 'notice ok'}>{done}</div>;
    default:
      return null;
  }
};

type PanelProps = { session: BuildingSession; state: SafeJeonseDerivedState };

/* ------------------------------------------------------------------ landlord */

export const LandlordPanel: React.FC<PanelProps> = ({ session, state }) => {
  const [leaseAmount, setLeaseAmount] = useState('');
  const [codeStatus, createCode] = useAction<string>();
  const [offerAmount, setOfferAmount] = useState('');
  const [certStatus, certify] = useAction<boolean>();
  const lease = parseManwon(leaseAmount);
  const offer = parseManwon(offerAmount);

  if (!state.isLandlord) {
    return (
      <div className="notice">
        This browser session didn&apos;t register this building, so it can&apos;t act as its landlord. Register a new
        building to try the landlord role.
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>1. Give a tenant a lease code</h3>
      <p className="explain">
        The code holds the deposit amount plus a random salt. The tenant checks it against the paper lease, then seals
        it on-chain. You never write a tenant&apos;s deposit to the chain yourself.
      </p>
      <label className="field">
        <span>Deposit (만원)</span>
        <input
          inputMode="numeric"
          value={leaseAmount}
          onChange={(e) => setLeaseAmount(e.target.value)}
          placeholder="8000"
        />
        <em>{lease === null ? 'Whole number of 만원, e.g. 8000 = 8천만원' : formatManwon(lease)}</em>
      </label>
      <button
        className="btn"
        disabled={lease === null || codeStatus.kind === 'busy'}
        onClick={() => lease !== null && void createCode('Creating code', () => session.createLeaseCode(lease))}
      >
        Create lease code
      </button>
      {codeStatus.kind === 'done' && <CopyCode code={codeStatus.value} />}
      {codeStatus.kind === 'failed' && <Status status={codeStatus} />}

      <h3>2. Prove a new deposit is safe</h3>
      <p className="explain">
        A zero-knowledge proof is built over every sealed deposit, on your own machine. Only the verdict is published.
      </p>
      <label className="field">
        <span>New deposit being offered (만원)</span>
        <input
          inputMode="numeric"
          value={offerAmount}
          onChange={(e) => setOfferAmount(e.target.value)}
          placeholder="7000"
        />
        <em>{offer === null ? 'Whole number of 만원' : formatManwon(offer)}</em>
      </label>
      <button
        className="btn seal-btn"
        disabled={offer === null || certStatus.kind === 'busy'}
        onClick={() =>
          offer !== null &&
          void certify('Building the proof and submitting. This can take a minute.', () => session.certify(offer))
        }
      >
        Issue certificate
      </button>
      <Status
        status={certStatus}
        neutral
        done={
          certStatus.kind === 'done' && (certStatus.value ? 'Certificate issued: SAFE' : 'Certificate issued: RISKY')
        }
      />
    </div>
  );
};

const CopyCode: React.FC<{ code: string }> = ({ code }) => {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <div className="code-box">{code}</div>
      <button
        className="btn ghost"
        onClick={() =>
          void navigator.clipboard.writeText(code).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        {copied ? 'Copied' : 'Copy code'}
      </button>
    </>
  );
};

/* ----------------------------------------------------------------- registrar */

export const RegistrarPanel: React.FC<PanelProps> = ({ session, state }) => {
  const [value, setValue] = useState(state.building.buildingValue.toString());
  const [liens, setLiens] = useState(state.building.seniorLiens.toString());
  const [status, attest] = useAction<void>();
  const buildingValue = parseManwon(value);
  const seniorLiens = liens.trim() === '0' ? 0n : parseManwon(liens);

  if (!state.isRegistrar) {
    return (
      <div className="notice">Only the official registry office can change this building&apos;s register data.</div>
    );
  }

  return (
    <div className="panel">
      <h3>Record a register change</h3>
      <p className="explain">
        Only the registry office (등기소) can set the building value and the mortgage. When the register changes, for
        example because the landlord takes out a new loan, record it here. Every earlier certificate is then marked out
        of date.
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
      <button
        className="btn"
        disabled={buildingValue === null || seniorLiens === null || status.kind === 'busy'}
        onClick={() =>
          buildingValue !== null &&
          seniorLiens !== null &&
          void attest('Recording the change on-chain', () => session.attestRegister({ buildingValue, seniorLiens }))
        }
      >
        Record on-chain
      </button>
      <Status status={status} done="Register data updated." />
    </div>
  );
};

/* -------------------------------------------------------------------- tenant */

export const TenantPanel: React.FC<PanelProps> = ({ session, state }) => {
  const [code, setCode] = useState('');
  const [declareStatus, declare, resetDeclare] = useAction<bigint>();
  const [withdrawStatus, withdraw] = useAction<void>();

  const preview = useMemo((): { amount: bigint } | { error: string } | null => {
    if (code.trim() === '') {
      return null;
    }
    try {
      return { amount: decodeLeaseCode(code).amount };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }, [code]);

  return (
    <div className="panel">
      <h3>Seal my deposit</h3>
      <p className="explain">
        Paste the code from your landlord. A proof on your own machine shows you know the amount, and only a salted hash
        goes on-chain. After this, the landlord can&apos;t leave your deposit out or make it look smaller.
      </p>
      <label className="field">
        <span>Lease code</span>
        <input
          className="code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            resetDeclare();
          }}
          placeholder="SJ1-8000-…"
        />
        {preview !== null && 'amount' in preview && (
          <em>
            This code says your deposit is <strong>{formatManwon(preview.amount)}</strong>. Check it matches your lease.
          </em>
        )}
        {preview !== null && 'error' in preview && <em style={{ color: 'var(--seal)' }}>{preview.error}</em>}
      </label>
      <button
        className="btn"
        disabled={preview === null || !('amount' in preview) || declareStatus.kind === 'busy'}
        onClick={() => void declare('Building the proof and submitting', () => session.declareDeposit(code))}
      >
        Seal deposit on-chain
      </button>
      <Status
        status={declareStatus}
        done={declareStatus.kind === 'done' && `Sealed in slot ${declareStatus.value.toString()}.`}
      />

      <h3>My deposits</h3>
      {state.myDeposits.length === 0 ? (
        <p className="explain">You haven&apos;t sealed a deposit in this building.</p>
      ) : (
        state.myDeposits.map((deposit) => (
          <div className="row" key={deposit.slot.toString()} style={{ marginBottom: 8 }}>
            <span>
              Slot {deposit.slot.toString()}: <strong>{formatManwon(deposit.amount)}</strong>{' '}
              <small style={{ color: 'var(--ink-soft)' }}>(only you can see this)</small>
            </span>
            <button
              className="btn ghost"
              disabled={withdrawStatus.kind === 'busy'}
              onClick={() => void withdraw('Releasing slot', () => session.withdrawDeposit(deposit.slot))}
            >
              I moved out
            </button>
          </div>
        ))
      )}
      <Status status={withdrawStatus} />
    </div>
  );
};

/* -------------------------------------------------------------------- renter */

export const RenterPanel: React.FC<{ state: SafeJeonseDerivedState }> = ({ state }) => {
  const cert = state.certificate;
  const occupied = state.slots.filter((s) => s.occupied).length;
  return (
    <div className="panel">
      <h3>Should I sign?</h3>
      {cert === null ? (
        <p className="explain">
          Ask the landlord to issue a certificate for the deposit you are being offered. It appears in the register on
          the left as soon as it is on-chain.
        </p>
      ) : cert.stale ? (
        <div className="notice">The latest certificate is out of date. Ask the landlord for a fresh one.</div>
      ) : (
        <div className={`notice ${cert.safe ? 'ok' : 'error'}`}>
          {cert.safe
            ? `For ${formatManwon(cert.newDeposit)}, liens plus all ${occupied} earlier deposits plus yours fit inside ${formatManwon(state.exposureLimit)}.`
            : `For ${formatManwon(cert.newDeposit)}, the building is already carrying too much. If it were sold at auction, earlier claims could eat your deposit.`}
        </div>
      )}
      <h3>What you can see</h3>
      <ul className="explain">
        <li>Building value and mortgage (public register data)</li>
        <li>How many deposits are sealed: {occupied}</li>
        <li>A verdict proven over every one of them</li>
      </ul>
      <h3>What nobody can see</h3>
      <ul className="explain">
        <li>How much any other tenant paid</li>
        <li>Who those tenants are</li>
      </ul>
    </div>
  );
};
