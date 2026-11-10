import { PletopayCheckoutError } from './errors';
import type { PublicCheckoutSession } from './types';

export const DEFAULT_API_URL = 'https://api.pletopay.com';
export const DEFAULT_CHECKOUT_URL = 'https://checkout.pletopay.com';
/** The checkout API allows about two requests a second per device; poll no faster than this. */
export const MIN_POLL_INTERVAL_MS = 2000;
/**
 * A session can stay `open` for a while after its `expires_at` (a transfer sent just before the
 * deadline is still accepted while it is confirmed) and can still become `complete` then. From
 * `expires_at` on, polling slows to this interval.
 */
export const POST_EXPIRY_POLL_INTERVAL_MS = 15_000;
/** How long after the session's `expires_at` polling keeps waiting for a final state by default. */
export const POLL_DEADLINE_AFTER_EXPIRY_MS = 30 * 60_000;
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
  /** Give up after this long (default: until 30 minutes after the session's `expires_at`). */
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

  /**
   * Polls until the session is no longer `open` (complete or expired), the signal aborts, or the
   * timeout passes. Once the session's `expires_at` has passed it polls every 15 s at most: the
   * session stays `open` until Pletopay has settled whether a late transfer arrived.
   */
  async pollSession(session: string, options: PollOptions = {}): Promise<PublicCheckoutSession> {
    const interval = Math.max(MIN_POLL_INTERVAL_MS, options.intervalMs ?? 4000);
    let current = options.initial ?? (await this.getSession(session));
    if (!options.initial) options.onUpdate?.(current);
    // `|| 0`: an unreadable `expires_at` counts from now.
    const deadline =
      Date.now() + (options.timeoutMs ?? Math.max(0, msUntil(current.expires_at) || 0) + POLL_DEADLINE_AFTER_EXPIRY_MS);
    while (current.status === 'open') {
      if (options.signal?.aborted) return current;
      if (Date.now() > deadline)
        throw new PletopayCheckoutError(
          'timeout',
          'Gave up waiting for the checkout session to complete',
          undefined,
          true,
        );
      const expired = msUntil(current.expires_at) <= 0;
      await sleep(expired ? Math.max(interval, POST_EXPIRY_POLL_INTERVAL_MS) : interval, options.signal);
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

/** Milliseconds from now until an ISO timestamp (negative once it has passed); NaN if it cannot be read. */
function msUntil(timestamp: string): number {
  return Date.parse(timestamp) - Date.now();
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
