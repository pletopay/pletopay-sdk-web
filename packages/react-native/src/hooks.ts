import { useCallback, useEffect, useRef, useState } from 'react';
import type { PletopayCheckoutClient } from './client';
import { PletopayCheckoutError } from './errors';
import { usePletopayClient } from './provider';
import type { PublicCheckoutSession } from './types';

export interface UseCheckoutSessionOptions {
  /** Keep polling while the session is `open`. Default true. */
  poll?: boolean;
  /** Default 4000 ms, never below 2000. */
  intervalMs?: number;
  /** Issue the bank-transfer account as soon as the hook mounts (for native screens). Default false. */
  openOnMount?: boolean;
  client?: PletopayCheckoutClient;
}

export interface UseCheckoutSession {
  session: PublicCheckoutSession | null;
  /** `loading` until the first fetch, then the session's status. */
  status: 'loading' | 'open' | 'complete' | 'expired' | 'error';
  error: PletopayCheckoutError | null;
  /** Fetches the current state now. */
  refresh: () => Promise<PublicCheckoutSession | null>;
  /** Issues the account details (idempotent). */
  open: () => Promise<PublicCheckoutSession | null>;
}

/**
 * Tracks a checkout session for a native screen: fetches it, optionally issues the account details,
 * and polls while it is open so `status` becomes `complete` when the transfer is confirmed.
 */
export function useCheckoutSession(
  token: string | null | undefined,
  options: UseCheckoutSessionOptions = {},
): UseCheckoutSession {
  const shared = usePletopayClient();
  const client = options.client ?? shared;
  const [session, setSession] = useState<PublicCheckoutSession | null>(null);
  const [error, setError] = useState<PletopayCheckoutError | null>(null);
  const alive = useRef(true);
  const poll = options.poll ?? true;
  const intervalMs = options.intervalMs;
  const openOnMount = options.openOnMount ?? false;

  const apply = useCallback((next: PublicCheckoutSession | null): PublicCheckoutSession | null => {
    if (alive.current && next) {
      setSession(next);
      setError(null);
    }
    return next;
  }, []);

  const run = useCallback(
    async (fn: () => Promise<PublicCheckoutSession>): Promise<PublicCheckoutSession | null> => {
      if (!token) return null;
      try {
        return apply(await fn());
      } catch (err) {
        if (alive.current)
          setError(err instanceof PletopayCheckoutError ? err : new PletopayCheckoutError('unknown', String(err)));
        return null;
      }
    },
    [token, apply],
  );

  const refresh = useCallback(() => run(() => client.getSession(token ?? '')), [run, client, token]);
  const open = useCallback(() => run(() => client.openSession(token ?? '')), [run, client, token]);

  useEffect(() => {
    alive.current = true;
    setSession(null);
    setError(null);
    if (!token) return;
    const controller = new AbortController();
    void (async () => {
      const first = openOnMount ? await open() : await refresh();
      if (!first || !poll || first.status !== 'open') return;
      try {
        await client.pollSession(token, { intervalMs, signal: controller.signal, onUpdate: apply, initial: first });
      } catch (err) {
        if (alive.current)
          setError(err instanceof PletopayCheckoutError ? err : new PletopayCheckoutError('unknown', String(err)));
      }
    })();
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [token, client, poll, intervalMs, openOnMount, open, refresh, apply]);

  return {
    session,
    status: error && !session ? 'error' : session ? session.status : 'loading',
    error,
    refresh,
    open,
  };
}
