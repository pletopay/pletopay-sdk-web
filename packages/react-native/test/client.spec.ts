import {
  POLL_DEADLINE_AFTER_EXPIRY_MS,
  POST_EXPIRY_POLL_INTERVAL_MS,
  PletopayCheckoutClient,
  PletopayCheckoutError,
} from '../src';
import { TOKEN, apiError, envelope, fetchMock, session } from './helpers';

describe('PletopayCheckoutClient', () => {
  it('resolves tokens and hosted URLs', () => {
    const client = new PletopayCheckoutClient({ checkoutUrl: 'https://checkout.pletopay.com/' });
    expect(client.resolveToken(TOKEN)).toBe(TOKEN);
    expect(client.resolveToken(`https://checkout.pletopay.com/c/${TOKEN}`)).toBe(TOKEN);
    expect(client.hostedUrl(TOKEN)).toBe(`https://checkout.pletopay.com/c/${TOKEN}`);
    expect(() => client.resolveToken('nope')).toThrow(PletopayCheckoutError);
    expect(() => client.resolveToken('https://evil.test/c/../x')).toThrow(/token/);
    expect(() => new PletopayCheckoutClient({ apiUrl: 'not a url' })).toThrow(PletopayCheckoutError);
  });

  it('reads and opens sessions through the envelope', async () => {
    const { fetch, calls } = fetchMock([
      envelope(session()),
      envelope(
        session({
          bank_transfer: {
            account_number: '9821110017',
            account_name: 'Ada',
            bank_name: 'Bank',
            bank_code: '090',
            amount: 150000,
            expires_at: 'x',
          },
        }),
      ),
    ]);
    const client = new PletopayCheckoutClient({ apiUrl: 'http://api.test', fetch });
    expect((await client.getSession(TOKEN)).status).toBe('open');
    expect((await client.openSession(TOKEN)).bank_transfer?.account_number).toBe('9821110017');
    expect(calls).toEqual([
      { url: `http://api.test/checkout/v1/sessions/${TOKEN}`, method: 'GET' },
      { url: `http://api.test/checkout/v1/sessions/${TOKEN}/open`, method: 'POST' },
    ]);
  });

  it('maps API errors, network errors and timeouts', async () => {
    const { fetch } = fetchMock([
      apiError(404, 'not_found'),
      apiError(429, 'rate_limited'),
      new TypeError('offline'),
      new Response('<html>', { status: 502 }),
    ]);
    const client = new PletopayCheckoutClient({ apiUrl: 'http://api.test', fetch });
    await expect(client.getSession(TOKEN)).rejects.toMatchObject({ code: 'not_found', status: 404, retryable: false });
    await expect(client.getSession(TOKEN)).rejects.toMatchObject({ code: 'rate_limited', retryable: true });
    await expect(client.getSession(TOKEN)).rejects.toMatchObject({ code: 'network_error', retryable: true });
    await expect(client.getSession(TOKEN)).rejects.toMatchObject({
      code: 'service_unavailable',
      status: 502,
      retryable: true,
    });
    const slow = new PletopayCheckoutClient({
      apiUrl: 'http://api.test',
      timeoutMs: 20,
      fetch: ((_u: string, init?: RequestInit) =>
        new Promise<Response>((_r, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        )) as typeof globalThis.fetch,
    });
    await expect(slow.getSession(TOKEN)).rejects.toMatchObject({ code: 'timeout', retryable: true });
  });

  it('polls until the session is no longer open, skipping retryable errors', async () => {
    jest.useFakeTimers();
    const { fetch } = fetchMock([
      envelope(session()),
      envelope(session()),
      apiError(503, 'service_unavailable'),
      envelope(session({ status: 'complete', payment_status: 'succeeded' })),
    ]);
    const client = new PletopayCheckoutClient({ apiUrl: 'http://api.test', fetch });
    const seen: string[] = [];
    const promise = client.pollSession(TOKEN, { intervalMs: 500, onUpdate: (s) => seen.push(s.status) });
    for (let i = 0; i < 4; i++) await jest.advanceTimersByTimeAsync(2000);
    const last = await promise;
    expect(last.status).toBe('complete');
    expect(seen).toEqual(['open', 'open', 'complete']);
    jest.useRealTimers();

    const known = session({ status: 'complete' });
    const quiet = fetchMock([]);
    const fromInitial = await new PletopayCheckoutClient({ apiUrl: 'http://api.test', fetch: quiet.fetch }).pollSession(
      TOKEN,
      { initial: known },
    );
    expect(fromInitial).toBe(known);
    expect(quiet.calls).toHaveLength(0);
  });

  it('stops polling when the signal aborts and times out eventually', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const { fetch, calls } = fetchMock([envelope(session()), envelope(session()), envelope(session())]);
    const client = new PletopayCheckoutClient({ apiUrl: 'http://api.test', fetch });
    const promise = client.pollSession(TOKEN, { intervalMs: 2000, signal: controller.signal });
    await jest.advanceTimersByTimeAsync(2500);
    controller.abort();
    expect((await promise).status).toBe('open');
    expect(calls.length).toBeLessThanOrEqual(2);

    const { fetch: f2 } = fetchMock(Array.from({ length: 10 }, () => envelope(session())));
    const c2 = new PletopayCheckoutClient({ apiUrl: 'http://api.test', fetch: f2 });
    const p2 = c2.pollSession(TOKEN, { intervalMs: 2000, timeoutMs: 5000 }).catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(9000);
    expect(await p2).toMatchObject({ code: 'timeout' });
    jest.useRealTimers();
  });

  it('keeps polling an open session past expires_at, every 15 s, until 30 minutes after it', async () => {
    jest.useFakeTimers();
    const start = Date.now();
    const expires_at = new Date(start + 10_000).toISOString();
    const at: number[] = [];
    const client = new PletopayCheckoutClient({
      apiUrl: 'http://api.test',
      fetch: async () => {
        at.push(Date.now() - start);
        return envelope(session({ expires_at }));
      },
    });
    const outcome = client.pollSession(TOKEN, { intervalMs: 2000 }).catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(10_000 + POLL_DEADLINE_AFTER_EXPIRY_MS - 1000);
    // Every 2 s until expires_at, every 15 s from then on, and still going long after the old one-minute allowance.
    expect(at.slice(0, 9)).toEqual([0, 2000, 4000, 6000, 8000, 10_000, 25_000, 40_000, 55_000]);
    expect(at.at(-1)).toBe(10_000 + POLL_DEADLINE_AFTER_EXPIRY_MS - POST_EXPIRY_POLL_INTERVAL_MS);
    await jest.advanceTimersByTimeAsync(1000 + POST_EXPIRY_POLL_INTERVAL_MS);
    expect(await outcome).toMatchObject({ code: 'timeout', retryable: true });
    const polled = at.length;
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(at).toHaveLength(polled);
  });

  it('returns a completion that arrives after expires_at, and lets an explicit timeout or a slower interval win', async () => {
    jest.useFakeTimers();
    const start = Date.now();
    const expires_at = new Date(start + 10_000).toISOString();
    const polling = (completeAfterMs: number) => {
      const at: number[] = [];
      const client = new PletopayCheckoutClient({
        apiUrl: 'http://api.test',
        fetch: async () => {
          at.push(Date.now() - start);
          return envelope(session({ expires_at, status: Date.now() - start >= completeAfterMs ? 'complete' : 'open' }));
        },
      });
      return { at, client };
    };

    const late = polling(10_000 + 12 * 60_000);
    const completed = late.client.pollSession(TOKEN, { intervalMs: 2000 });
    const explicit = polling(Infinity);
    const timedOut = explicit.client
      .pollSession(TOKEN, { intervalMs: 2000, timeoutMs: 60_000 })
      .catch((e: unknown) => e);
    const slow = polling(Infinity);
    const controller = new AbortController();
    const slowPoll = slow.client.pollSession(TOKEN, { intervalMs: 20_000, signal: controller.signal });

    await jest.advanceTimersByTimeAsync(10_000 + 13 * 60_000);
    expect((await completed).status).toBe('complete');
    expect(late.at.at(-1)).toBe(10_000 + 12 * 60_000);
    expect(await timedOut).toMatchObject({ code: 'timeout' });
    expect(explicit.at.at(-1)).toBeLessThanOrEqual(60_000 + POST_EXPIRY_POLL_INTERVAL_MS);
    expect(slow.at.slice(0, 4)).toEqual([0, 20_000, 40_000, 60_000]); // a slower caller interval is kept
    controller.abort();
    expect((await slowPoll).status).toBe('open');
  });
});
