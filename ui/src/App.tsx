// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useState } from 'react';
import { type LedgerRow, type SafeJeonseDerivedState } from '../../api/src/index';
import { type Backend, type BuildingSession, PERSONAS, type Persona } from './backend';
import { Register } from './components/Register';
import { LandlordPanel, RegistrarPanel, RenterPanel, TenantPanel } from './components/Panels';
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
  | { kind: 'ready'; session: BuildingSession }
  | { kind: 'failed'; message: string };

const App: React.FC<{ backend: Backend }> = ({ backend }) => {
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
    backend.open(address);
    setConnection({ kind: 'connecting' });
    backend.as(persona).then(
      (session) => !cancelled && setConnection({ kind: 'ready', session }),
      (error: unknown) => !cancelled && setConnection({ kind: 'failed', message: errorMessage(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [backend, address, persona]);

  // Follow the combined public + private state of the active persona.
  useEffect(() => {
    if (connection.kind !== 'ready') {
      return;
    }
    const subscription = connection.session.state$.subscribe({
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
        <Start backend={backend} onReady={onBuildingReady} />
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
                <LandlordPanel session={connection.session} state={state} />
              ) : persona === 'registrar' ? (
                <RegistrarPanel session={connection.session} state={state} />
              ) : persona === 'renter' ? (
                <RenterPanel state={state} />
              ) : (
                <TenantPanel key={persona} session={connection.session} state={state} />
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

      {state !== null && connection.kind === 'ready' && (
        <RawLedger session={connection.session} revision={state.revision} />
      )}

      <footer className="footer">
        Built on Midnight. Deposits are stored as salted commitments and checked inside a zero-knowledge circuit.
        Amounts are in 만원 (10,000 KRW).
      </footer>
    </div>
  );
};

const RawLedger: React.FC<{ session: BuildingSession; revision: bigint }> = ({ session, revision }) => {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    session.ledgerRows().then(
      (next) => {
        if (!cancelled) {
          setRows(next);
          setError(null);
        }
      },
      (failure: unknown) => !cancelled && setError(errorMessage(failure)),
    );
    return () => {
      cancelled = true;
    };
  }, [session, revision]);

  return (
    <section className="sheet">
      <details className="raw">
        <summary>Show exactly what is stored on-chain</summary>
        <p className="explain" style={{ marginTop: 10 }}>
          This is everything anyone can read from the contract. There is no deposit amount in it.
        </p>
        <pre>
          {error !== null
            ? `Could not read the ledger: ${error}`
            : rows
                .map((row) => `${row.label.padEnd(18)}${row.value}${row.emptySlot === true ? '  (empty slot)' : ''}`)
                .join('\n')}
        </pre>
      </details>
    </section>
  );
};

export default App;
