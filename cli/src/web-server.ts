// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

/*
 * Local web backend for the demo UI. The browser never holds a wallet: this
 * process builds the zero-knowledge proofs and submits transactions to the local
 * Midnight network, exactly like `npm run demo` does. It listens on 127.0.0.1 only.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { type Logger } from 'pino';
import {
  SafeJeonseAPI,
  type Persona,
  bigintReplacer,
  isPersona,
  ledgerRows,
  registerBuilding,
  validateRegisterData,
  validateSafeRatio,
} from '../../api/src/index';
import { type Session } from './index.js';

const MAX_BODY_BYTES = 16 * 1024;
const CONTRACT_ADDRESS = /^[0-9a-f]{64,}$/i;
const WHOLE_NUMBER = /^\d{1,19}$/;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.png': 'image/png',
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Request body is too large');
    }
    chunks.push(buffer);
  }
  if (size === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
};

const amountField = (body: Record<string, unknown>, field: string): bigint => {
  const raw = body[field];
  if (typeof raw !== 'string' || !WHOLE_NUMBER.test(raw)) {
    throw new HttpError(400, `"${field}" must be a whole number sent as a string`);
  }
  return BigInt(raw);
};

const stringField = (body: Record<string, unknown>, field: string): string => {
  const raw = body[field];
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new HttpError(400, `"${field}" is required`);
  }
  return raw;
};

const personaField = (value: unknown): Persona => {
  if (!isPersona(value)) {
    throw new HttpError(400, 'Unknown persona');
  }
  return value;
};

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body, bigintReplacer));
};

/** Runs transactions one after another, since every persona pays fees from the same local wallet. */
class TxQueue {
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(task, task);
    this.#tail = result.catch(() => undefined);
    return result;
  }
}

export class WebBackend {
  readonly #apis = new Map<string, Promise<SafeJeonseAPI>>();
  readonly #queue = new TxQueue();

  constructor(
    private readonly session: Session,
    private readonly staticDir: string,
    private readonly logger: Logger,
  ) {}

  listen(port: number): Promise<Server> {
    const server = createServer((req, res) => {
      this.handle(req, res).catch((error: unknown) => {
        const status = error instanceof HttpError ? error.status : 500;
        const message = error instanceof Error ? error.message : String(error);
        if (status >= 500) {
          this.logger.error({ err: error }, 'Request failed');
        }
        send(res, status, { error: message });
      });
    });
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve(server));
    });
  }

  private api(address: string, persona: Persona): Promise<SafeJeonseAPI> {
    if (!CONTRACT_ADDRESS.test(address)) {
      return Promise.reject(new HttpError(400, 'Invalid contract address'));
    }
    const key = `${address}:${persona}`;
    const existing = this.#apis.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const joined = SafeJeonseAPI.join(
      this.session.providers(persona),
      address,
      this.quietLogger(),
      persona === 'registrar' ? this.session.registrarSecretKey : undefined,
    );
    joined.catch(() => this.#apis.delete(key));
    this.#apis.set(key, joined);
    return joined;
  }

  private quietLogger(): Logger {
    return this.logger.child({}, { level: 'warn' });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts[0] !== 'api') {
      await this.serveStatic(url.pathname, res);
      return;
    }

    // POST /api/buildings
    if (req.method === 'POST' && parts.length === 2 && parts[1] === 'buildings') {
      const body = await readJson(req);
      const registration = {
        buildingValue: amountField(body, 'buildingValue'),
        seniorLiens: amountField(body, 'seniorLiens'),
        safeRatioPercent: amountField(body, 'safeRatioPercent'),
      };
      try {
        validateRegisterData(registration);
        validateSafeRatio(registration.safeRatioPercent);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      const { landlord, registrar } = await this.#queue.run(() =>
        registerBuilding(
          this.session.providers('landlord'),
          this.session.providers('registrar'),
          registration,
          this.session.registrarSecretKey,
          this.quietLogger(),
        ),
      );
      const address = landlord.deployedContractAddress;
      this.#apis.set(`${address}:landlord`, Promise.resolve(landlord));
      this.#apis.set(`${address}:registrar`, Promise.resolve(registrar));
      send(res, 201, { address });
      return;
    }

    if (parts.length < 3 || parts[1] !== 'buildings') {
      throw new HttpError(404, 'Not found');
    }
    const address = parts[2];
    const action = parts[3];

    if (req.method === 'GET' && action === 'state') {
      const api = await this.api(address, personaField(url.searchParams.get('persona')));
      send(res, 200, await api.currentState());
      return;
    }

    if (req.method === 'GET' && action === 'ledger') {
      const api = await this.api(address, 'renter');
      send(res, 200, { rows: ledgerRows(await api.queryLedger()) });
      return;
    }

    if (req.method !== 'POST') {
      throw new HttpError(404, 'Not found');
    }
    const body = await readJson(req);
    const api = await this.api(address, personaField(body.persona));

    switch (action) {
      case 'lease-codes':
        send(res, 201, { code: await api.createLeaseCode(amountField(body, 'amount')) });
        return;
      case 'declare': {
        const code = stringField(body, 'code');
        send(res, 200, { slot: await this.#queue.run(() => api.declareDeposit(code)) });
        return;
      }
      case 'withdraw': {
        const slot = amountField(body, 'slot');
        await this.#queue.run(() => api.withdrawDeposit(slot));
        send(res, 200, { ok: true });
        return;
      }
      case 'attest': {
        const data = {
          buildingValue: amountField(body, 'buildingValue'),
          seniorLiens: amountField(body, 'seniorLiens'),
        };
        try {
          validateRegisterData(data);
        } catch (error) {
          throw new HttpError(400, error instanceof Error ? error.message : String(error));
        }
        await this.#queue.run(() => api.attestRegister(data));
        send(res, 200, { ok: true });
        return;
      }
      case 'certify': {
        const amount = amountField(body, 'amount');
        send(res, 200, { safe: await this.#queue.run(() => api.certify(amount)) });
        return;
      }
      default:
        throw new HttpError(404, 'Not found');
    }
  }

  private async serveStatic(pathname: string, res: ServerResponse): Promise<void> {
    const root = path.resolve(this.staticDir);
    const requested = path.resolve(root, `.${decodeURIComponent(pathname)}`);
    if (requested !== root && !requested.startsWith(`${root}${path.sep}`)) {
      throw new HttpError(403, 'Forbidden');
    }
    const file = await stat(requested).then(
      (info) => (info.isFile() ? requested : path.join(root, 'index.html')),
      () => path.join(root, 'index.html'),
    );
    const body = await readFile(file).catch(() => {
      throw new HttpError(500, `The web app is not built. Run "npm run build:local -w ui" first.`);
    });
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  }
}
