// SafeJeonse (안심전세 ZK)
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useState } from 'react';

export type ActionStatus<T> =
  { kind: 'idle' } | { kind: 'busy'; label: string } | { kind: 'done'; value: T } | { kind: 'failed'; message: string };

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Tracks one async action (idle, busy, done, failed) so panels can show progress and errors. */
export const useAction = <T>(): [
  ActionStatus<T>,
  (label: string, run: () => Promise<T>) => Promise<void>,
  () => void,
] => {
  const [status, setStatus] = useState<ActionStatus<T>>({ kind: 'idle' });

  const start = useCallback(async (label: string, run: () => Promise<T>) => {
    setStatus({ kind: 'busy', label });
    try {
      setStatus({ kind: 'done', value: await run() });
    } catch (error) {
      setStatus({ kind: 'failed', message: errorMessage(error) });
    }
  }, []);

  const reset = useCallback(() => setStatus({ kind: 'idle' }), []);
  return [status, start, reset];
};

/** Parses a 만원 amount typed by a person, accepting commas and spaces. */
export const parseManwon = (text: string): bigint | null => {
  const cleaned = text.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(cleaned)) {
    return null;
  }
  const value = BigInt(cleaned);
  return value > 0n ? value : null;
};
