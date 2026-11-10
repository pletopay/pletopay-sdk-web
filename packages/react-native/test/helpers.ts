import type { PublicCheckoutSession } from '../src/types';

export const TOKEN = '0OrCJ44hSQU_xb9de8Z7YiVAN01RQViC';

/** A session as the checkout API presents it: `success_url` is only revealed once it is complete. */
export function session(overrides: Partial<PublicCheckoutSession> = {}): PublicCheckoutSession {
  return {
    object: 'checkout_session',
    livemode: false,
    status: 'open',
    merchant: { name: 'Ada Stores', brand_color: null, support_email: null, support_url: null },
    amount: 150000,
    currency: 'NGN',
    description: null,
    payment_status: null,
    bank_transfer: null,
    success_url: overrides.status === 'complete' ? 'https://shop.test/thanks' : null,
    cancel_url: 'https://shop.test/cart',
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  };
}

export function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ status: status < 400, message: 'ok', data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function apiError(status: number, code: string, message = `${code} happened`): Response {
  return new Response(JSON.stringify({ status: false, message, error: { type: 'x', code }, request_id: 'req_1' }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A fetch double answering from a queue (functions get the request). */
export function fetchMock(
  replies: Array<Response | Error | ((url: string, init?: RequestInit) => Response | Promise<Response>)>,
) {
  const calls: Array<{ url: string; method: string }> = [];
  const queue = [...replies];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: init?.method ?? 'GET' });
    const next = queue.shift();
    if (!next) throw new Error(`fetchMock: no reply queued for ${url}`);
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(url, init);
    return next;
  };
  return { fetch: fetch as typeof globalThis.fetch, calls, queue };
}

export const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
