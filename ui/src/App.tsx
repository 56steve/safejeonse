// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { type Logger } from 'pino';
import { type SafeJeonseAPI, type SafeJeonseDerivedState } from '../../api/src/index';
import { BuildingManager, PERSONAS, type Persona } from './manager';
import { Register } from './components/Register';
import { LandlordPanel, RenterPanel, TenantPanel } from './components/Panels';
import { Start } from './components/Start';
import { errorMessage } from './components/useAction';

const BUILDING_PARAM = 'building';

const readAddressFromUrl = (): string | null => new URLSearchParams(window.location.search).get(BUILDING_PARAM);

const writeAddressToUrl = (address: string): void => {
  const url = new URL(window.location.href);
  url.searchParams.set(BUILDING_PARAM, address);
  window.history.replaceState(null, '', url);
};

type Connection =
  | { kind: 'none' }
  | { kind: 'connecting' }
  | { kind: 'ready'; api: SafeJeonseAPI }
  | { kind: 'failed'; message: string };

const App: React.FC<{ logger: Logger }> = ({ logger }) => {
  const [manager] = useState(() => new BuildingManager(logger));
  const [address, setAddress] = useState<string | null>(readAddressFromUrl);
  const [persona, setPersona] = useState<Persona>('landlord');
  const [connection, setConnection] = useState<Connection>({ kind: 'none' });
  const [state, setState] = useState<SafeJeonseDerivedState | null>(null);

  // Join the building as the selected persona whenever either changes.
  useEffect(() => {
    if (address === null) {
      return;
    }
    let cancelled = false;
    manager.open(address);
    setConnection({ kind: 'connecting' });
    manager.as(persona).then(
      (api) => !cancelled && setConnection({ kind: 'ready', api }),
      (error: unknown) => !cancelled && setConnection({ kind: 'failed', message: errorMessage(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [manager, address, persona]);

  // Follow the combined public + private state of the active persona.
  useEffect(() => {
    if (connection.kind !== 'ready') {
      return;
    }
    const subscription = connection.api.state$.subscribe({
      next: setState,
      error: (error: unknown) => setConnection({ kind: 'failed', message: errorMessage(error) }),
    });
    return () => subscription.unsubscribe();
  }, [connection]);

  const onBuildingReady = (next: string) => {
    writeAddressToUrl(next);
    setState(null);
    setAddress(next);
  };

  return (
    <div className="shell">
      <header className="masthead">
        <h1>
          <small>SafeJeonse · Midnight</small>
          안심전세 ZK
        </h1>
        <p>Check that a jeonse deposit is safe before you sign, without anyone revealing what other tenants paid.</p>
      </header>

      {address === null ? (
        <Start manager={manager} onReady={onBuildingReady} />
      ) : (
        <main className="layout">
          <div>
            {state === null ? (
              <section className="sheet">
                {connection.kind === 'failed' ? (
                  <div className="notice error" role="alert">
                    {connection.message}
                  </div>
                ) : (
                  <div className="busy">Reading the building from the chain</div>
                )}
              </section>
            ) : (
              <Register state={state} address={address} />
            )}
          </div>

          <section className="sheet" aria-labelledby="role-title">
            <h2 className="sheet-title" id="role-title">
              역할 <span>Acting as</span>
            </h2>
            <div className="personas" role="group" aria-label="Choose who you are">
              {PERSONAS.map((p) => (
                <button
                  key={p.id}
                  className="persona"
                  aria-pressed={persona === p.id}
                  onClick={() => {
                    setState(null);
                    setPersona(p.id);
                  }}
                >
                  {p.label}
                  <small>{p.hint}</small>
                </button>
              ))}
            </div>

            {connection.kind === 'ready' && state !== null ? (
              persona === 'landlord' ? (
                <LandlordPanel api={connection.api} state={state} />
              ) : persona === 'renter' ? (
                <RenterPanel state={state} />
              ) : (
                <TenantPanel key={persona} api={connection.api} state={state} />
              )
            ) : connection.kind === 'failed' ? (
              <div className="notice error">{connection.message}</div>
            ) : (
              <div className="busy">Connecting</div>
            )}

            <p className="explain" style={{ marginTop: 20, fontSize: 12.5 }}>
              In real life each role is a different person on their own device. This demo lets one browser play all of
              them, and each role keeps its own private data.
            </p>
          </section>
        </main>
      )}

      {state !== null && connection.kind === 'ready' && <RawLedger api={connection.api} revision={state.revision} />}

      <footer className="footer">
        Built on Midnight. Deposits are stored as salted commitments and checked inside a zero-knowledge circuit.
        Amounts are in 만원 (10,000 KRW).
      </footer>
    </div>
  );
};

const RawLedger: React.FC<{ api: SafeJeonseAPI; revision: bigint }> = ({ api, revision }) => {
  const [text, setText] = useState('');
  useEffect(() => {
    let cancelled = false;
    api.queryLedger().then(
      (ledger) => {
        if (cancelled) {
          return;
        }
        const hex = (b: Uint8Array) =>
          Array.from(b.slice(0, 10), (x) => x.toString(16).padStart(2, '0')).join('') + '…';
        const lines = [
          `landlord          ${hex(ledger.landlord)}`,
          `buildingValue     ${ledger.buildingValue}`,
          `seniorLiens       ${ledger.seniorLiens}`,
          `safeRatioPercent  ${ledger.safeRatioPercent}`,
          `declaredCount     ${ledger.declaredCount}`,
          `revision          ${ledger.revision}`,
          ...Array.from(ledger.declarations, ([slot, c]) => `declarations[${slot}]   ${hex(c)}`),
          `certNewDeposit    ${ledger.certNewDeposit}`,
          `certSafe          ${ledger.certSafe}`,
          `certRevision      ${ledger.certRevision}`,
        ];
        setText(lines.join('\n'));
      },
      (error: unknown) => !cancelled && setText(`Could not read the ledger: ${errorMessage(error)}`),
    );
    return () => {
      cancelled = true;
    };
  }, [api, revision]);

  return (
    <section className="sheet">
      <details className="raw">
        <summary>Show exactly what is stored on-chain</summary>
        <p className="explain" style={{ marginTop: 10 }}>
          This is everything anyone can read from the contract. There is no deposit amount in it.
        </p>
        <pre>{text}</pre>
      </details>
    </section>
  );
};

export default App;
