import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPletopay, type LoadPletopayOptions, type PletopayClient } from '@pletopay/js';
import { PletopayContext, type PletopayContextValue, type PletopayLoadStatus } from './context';

export interface PletopayProviderProps extends LoadPletopayOptions {
  /** Your publishable key (`pk_test_…` / `pk_live_…`). Never a secret key. */
  publicKey: string;
  /** Load pletopay.js as soon as the provider mounts (default) or only when a checkout opens. */
  loadOnMount?: boolean;
  children?: ReactNode;
}

/**
 * Loads pletopay.js and shares one client with every `usePletopay` / `usePletopayCheckout` below it.
 * Renders nothing itself and is safe to server-render: the script loads in the browser only.
 */
export function PletopayProvider({
  publicKey,
  checkoutUrl,
  timeoutMs,
  nonce,
  loadOnMount = true,
  children,
}: PletopayProviderProps) {
  const [client, setClient] = useState<PletopayClient | null>(null);
  const [status, setStatus] = useState<PletopayLoadStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const promise = useRef<Promise<PletopayClient | null> | null>(null);
  const alive = useRef(true);

  const getClient = useCallback((): Promise<PletopayClient | null> => {
    if (!publicKey) return Promise.reject(new Error('PletopayProvider needs a publicKey (pk_test_… / pk_live_…)'));
    if (!promise.current) {
      setStatus('loading');
      setError(null);
      promise.current = createPletopay(publicKey, { checkoutUrl, timeoutMs, nonce }).then(
        (created) => {
          if (alive.current) {
            setClient(created);
            setStatus(created ? 'ready' : 'idle');
          }
          return created;
        },
        (loadError: unknown) => {
          promise.current = null;
          const err = loadError instanceof Error ? loadError : new Error(String(loadError));
          if (alive.current) {
            setStatus('error');
            setError(err);
          }
          throw err;
        },
      );
    }
    return promise.current;
  }, [publicKey, checkoutUrl, timeoutMs, nonce]);

  useEffect(() => {
    alive.current = true;
    promise.current = null;
    setClient(null);
    setStatus('idle');
    if (loadOnMount) void getClient().catch(() => undefined);
    return () => {
      alive.current = false;
    };
  }, [getClient, loadOnMount]);

  const reload = useCallback(() => {
    promise.current = null;
    void getClient().catch(() => undefined);
  }, [getClient]);

  const value = useMemo<PletopayContextValue>(
    () => ({ client, status, error, getClient, reload, publicKey, checkoutUrl }),
    [client, status, error, getClient, reload, publicKey, checkoutUrl],
  );
  return <PletopayContext.Provider value={value}>{children}</PletopayContext.Provider>;
}
