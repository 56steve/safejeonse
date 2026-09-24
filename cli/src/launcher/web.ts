// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

// Starts a local Midnight network and serves the web app against it, no wallet extension needed.

import path from 'node:path';
import { createLogger } from '../logger-utils.js';
import { run, type Session } from '../index.js';
import { StandaloneConfig, currentDir } from '../config.js';
import { WebBackend } from '../web-server.js';
import { bold, say } from '../view.js';

const DEFAULT_PORT = 8787;

const port = Number(process.env.SAFEJEONSE_WEB_PORT ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new RangeError(`SAFEJEONSE_WEB_PORT must be a port number, got "${process.env.SAFEJEONSE_WEB_PORT}"`);
}

const staticDir = path.resolve(currentDir, '..', '..', 'ui', 'dist');

const serve = async (session: Session): Promise<void> => {
  const server = await new WebBackend(session, staticDir, session.logger).listen(port);
  say();
  say(bold(`SafeJeonse is running at http://localhost:${port}`));
  say('Press Ctrl+C to stop the web app and the local network.');
  await new Promise<void>((resolve) => {
    const stop = () => {
      server.close(() => resolve());
      // An open browser tab keeps polling over keep-alive connections, which
      // would otherwise hold close() open forever.
      server.closeAllConnections();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
};

const config = new StandaloneConfig();
const logger = await createLogger(config.logDir);
await run(config, config.getEnvironment(logger), logger, { kind: 'script', script: serve });
