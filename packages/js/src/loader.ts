import type { PletopayClient, PletopayOptions } from './pletopay-types';

/** `window.Pletopay`: the factory pletopay.js defines. */
export type PletopayFactory = (options: PletopayOptions) => PletopayClient;

declare global {
  interface Window {
    Pletopay?: PletopayFactory;
  }
}

/** Where Pletopay serves the checkout pages and pletopay.js. */
export const DEFAULT_CHECKOUT_URL = 'https://checkout.pletopay.com';
/** The major version of pletopay.js this package targets (`/v1/pletopay.js`). */
export const PLETOPAY_JS_VERSION = 'v1';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface LoadPletopayOptions {
  /** The checkout origin, default `https://checkout.pletopay.com`. Change it only for a self-hosted or staging checkout. */
  checkoutUrl?: string;
  /** Give up loading the script after this long. Default 30 000 ms. */
  timeoutMs?: number;
  /** A CSP nonce to put on the injected `<script>`. */
  nonce?: string;
}

export type PletopayLoadErrorCode =
  'unsupported_environment' | 'script_error' | 'timeout' | 'no_factory' | 'invalid_options';

/** pletopay.js could not be loaded. `code` says why; the same call can be retried. */
export class PletopayLoadError extends Error {
  override name = 'PletopayLoadError';
  constructor(
    readonly code: PletopayLoadErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

function normaliseCheckoutUrl(value: string | undefined): string {
  const raw = value ?? DEFAULT_CHECKOUT_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PletopayLoadError('invalid_options', `checkoutUrl is not a valid absolute URL: ${raw}`);
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new PletopayLoadError('invalid_options', 'checkoutUrl must be https (http is allowed for localhost only).');
  }
  return url.origin;
}

/** The URL of the script that will be injected for these options. */
export function resolvePletopayScriptUrl(options: LoadPletopayOptions = {}): string {
  return `${normaliseCheckoutUrl(options.checkoutUrl)}/${PLETOPAY_JS_VERSION}/pletopay.js`;
}

const inflight = new Map<string, Promise<PletopayFactory>>();

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function inject(src: string, timeoutMs: number, nonce: string | undefined): Promise<PletopayFactory> {
  return new Promise<PletopayFactory>((resolve, reject) => {
    const existing = window.Pletopay;
    if (typeof existing === 'function') {
      resolve(existing);
      return;
    }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    const created = !script;
    if (!script) {
      script = document.createElement('script');
      script.src = src;
      script.async = true;
      if (nonce) script.nonce = nonce;
      (document.head ?? document.body ?? document.documentElement).appendChild(script);
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new PletopayLoadError('timeout', `pletopay.js did not load within ${timeoutMs} ms (${src})`));
    }, timeoutMs);
    const onLoad = (): void => {
      cleanup();
      const factory = window.Pletopay;
      if (typeof factory === 'function') resolve(factory);
      else
        reject(
          new PletopayLoadError('no_factory', `pletopay.js loaded from ${src} but did not define window.Pletopay`),
        );
    };
    const onError = (event: Event): void => {
      cleanup();
      if (created) script?.remove();
      reject(new PletopayLoadError('script_error', `pletopay.js failed to load from ${src}`, { cause: event }));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      script?.removeEventListener('load', onLoad);
      script?.removeEventListener('error', onError);
    };
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
  });
}

/**
 * Loads pletopay.js once and resolves to its factory (`window.Pletopay`). Resolves to `null` outside a
 * browser (server rendering), so it is safe to call anywhere. Concurrent calls share one script; a failed
 * load is forgotten so the next call retries.
 */
export function loadPletopay(options: LoadPletopayOptions = {}): Promise<PletopayFactory | null> {
  if (!isBrowser()) return Promise.resolve(null);
  let src: string;
  try {
    src = resolvePletopayScriptUrl(options);
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
  let promise = inflight.get(src);
  if (!promise) {
    promise = inject(src, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.nonce).catch((error: unknown) => {
      inflight.delete(src);
      throw error;
    });
    inflight.set(src, promise);
  }
  return promise;
}

/**
 * Loads pletopay.js and creates a client for your publishable key. Resolves to `null` on the server.
 *
 * @example
 * const pletopay = await createPletopay('pk_test_…');
 * pletopay?.checkout({ session: token, onSuccess: ({ session }) => … });
 */
export async function createPletopay(
  publicKey: string,
  options: LoadPletopayOptions = {},
): Promise<PletopayClient | null> {
  const factory = await loadPletopay(options);
  if (!factory) return null;
  return factory({ publicKey, checkoutUrl: normaliseCheckoutUrl(options.checkoutUrl) });
}

/** Forgets cached loads (tests, or after removing the script tag yourself). */
export function resetPletopayLoader(): void {
  inflight.clear();
}
