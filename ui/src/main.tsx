// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

import './globals';
import './styles.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { setNetworkId, type NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import '@midnight-ntwrk/dapp-connector-api';
import * as pino from 'pino';
import App from './App';
import { type Backend } from './backend';
import { LaceBackend } from './lace-backend';
import { LocalBackend } from './local-backend';

const networkId = import.meta.env.VITE_NETWORK_ID as NetworkId;
setNetworkId(networkId);

const logger = pino.pino({ level: import.meta.env.VITE_LOGGING_LEVEL as string });

const backend: Backend = import.meta.env.VITE_BACKEND === 'local' ? new LocalBackend() : new LaceBackend(logger);

const root = document.getElementById('root');
if (root === null) {
  throw new Error('Missing #root element in index.html');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App backend={backend} />
  </React.StrictMode>,
);
