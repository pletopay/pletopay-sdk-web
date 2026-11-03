import { PletopayCheckoutError } from './errors';
import type { PublicCheckoutSession } from './types';

export const DEFAULT_API_URL = 'https://api.pletopay.com';
export const DEFAULT_CHECKOUT_URL = 'https://checkout.pletopay.com';
/** The checkout API allows about two requests a second per device; poll no faster than this. */
export const MIN_POLL_INTERVAL_MS = 2000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export interface PletopayCheckoutClientOptions {
  /** The API origin. Default `https://api.pletopay.com`. */
  apiUrl?: string;
  /** The hosted checkout origin. Default `https://checkout.pletopay.com`. */
  checkoutUrl?: string;
  /** Custom `fetch` (tests, instrumentation). */
  fetch?: typeof globalThis.fetch;
  /** Per-request timeout. Default 20 000 ms. */
  timeoutMs?: number;
}

export interface PollOptions {
  /** Default 4000 ms, never below 2000. */
  intervalMs?: number;
  /** Stops polling. */
  signal?: AbortSignal;
  /** Called with every fetched session, including the first. */
  onUpdate?: (session: PublicCheckoutSession) => void;
  /** Give up after this long (default: until the session's `expires_at`, plus a minute). */
  timeoutMs?: number;
  /** A state you already fetched: polling starts from it instead of fetching again. */
  initial?: PublicCheckoutSession;
}

function normaliseOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PletopayCheckoutError('invalid_session', `${name} is not a valid absolute URL: ${value}`);
  }
  return url.origin;
}

/**
 * Reads checkout sessions through the customer-facing API, which needs only the session token (no
 * key of any kind). Use it to build a native checkout screen, or let `<PletopayCheckout>` use it.
 */
export class PletopayCheckoutClient {
  readonly apiUrl: string;
  readonly checkoutUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(options: PletopayCheckoutClientOptions = {}) {
    this.apiUrl = normaliseOrigin(options.apiUrl ?? DEFAULT_API_URL, 'apiUrl');
    this.checkoutUrl = normaliseOrigin(options.checkoutUrl ?? DEFAULT_CHECKOUT_URL, 'checkoutUrl');
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  /** The session token from a token or a hosted URL (`…/c/<token>`). */
  resolveToken(session: string): string {
    const value = session.trim();
    if (TOKEN_PATTERN.test(value)) return value;
    try {
      const url = new URL(value);
      const match = /^\/c\/([A-Za-z0-9_-]{8,64})$/.exec(url.pathname);
      if (match?.[1]) return match[1];
    } catch {
      // not a URL
    }
    throw new PletopayCheckoutError(
      'invalid_session',
      'session must be a checkout session token or its hosted URL (…/c/<token>)',
    );
  }

  /** The hosted checkout page for a session. */
  hostedUrl(session: string): string {
    return `${this.checkoutUrl}/c/${encodeURIComponent(this.resolveToken(session))}`;
  }

  /** The session's current state. */
  getSession(session: string): Promise<PublicCheckoutSession> {
    return this.request('GET', `/checkout/v1/sessions/${encodeURIComponent(this.resolveToken(session))}`);
  }

  /** Opens the session: issues the bank-transfer account (idempotent). Call it when your own screen is ready to show the details. */
  openSession(session: string): Promise<PublicCheckoutSession> {
    return this.request('POST', `/checkout/v1/sessions/${encodeURIComponent(this.resolveToken(session))}/open`);
  }

  /** Polls until the session is no longer `open` (complete or expired), the signal aborts, or the timeout passes. */
  async pollSession(session: string, options: PollOptions = {}): Promise<PublicCheckoutSession> {
    const interval = Math.max(MIN_POLL_INTERVAL_MS, options.intervalMs ?? 4000);
    let current = options.initial ?? (await this.getSession(session));
    if (!options.initial) options.onUpdate?.(current);
    const deadline =
      Date.now() + (options.timeoutMs ?? Math.max(60_000, Date.parse(current.expires_at) - Date.now() + 60_000));
    while (current.status === 'open') {
      if (options.signal?.aborted) return current;
      if (Date.now() > deadline)
        throw new PletopayCheckoutError(
          'timeout',
          'Gave up waiting for the checkout session to complete',
          undefined,
          true,
        );
      await sleep(interval, options.signal);
      if (options.signal?.aborted) return current;
      try {
        current = await this.getSession(session);
      } catch (error) {
        if (error instanceof PletopayCheckoutError && error.retryable) continue;
        throw error;
      }
      options.onUpdate?.(current);
    }
    return current;
  }

  private async request<T>(method: 'GET' | 'POST', path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}${path}`, {
        method,
        headers: { accept: 'application/json', 'x-pletopay-client': 'react-native' },
        signal: controller.signal,
      });
    } catch (cause) {
      if (controller.signal.aborted)
        throw new PletopayCheckoutError('timeout', `${method} ${path} timed out`, undefined, true, { cause });
      throw new PletopayCheckoutError(
        'network_error',
        `${method} ${path} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        undefined,
        true,
        { cause },
      );
    } finally {
      clearTimeout(timer);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    if (response.ok && typeof body === 'object' && body !== null && 'data' in body) return (body as { data: T }).data;
    const envelope = body as { message?: string; error?: { code?: string } } | undefined;
    const code =
      envelope?.error?.code ??
      (response.status === 404
        ? 'not_found'
        : response.status === 429
          ? 'rate_limited'
          : response.status >= 500
            ? 'service_unavailable'
            : 'unknown');
    throw new PletopayCheckoutError(
      code,
      envelope?.message ?? `Request failed with HTTP ${response.status}`,
      response.status,
      response.status === 429 || response.status >= 500,
    );
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      signal?.removeEventListener('abort', done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener('abort', done);
  });
}
