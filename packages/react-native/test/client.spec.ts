import { PletopayCheckoutClient, PletopayCheckoutError } from '../src';
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
});
