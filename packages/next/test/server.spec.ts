import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateTestHeaderString } from '@pletopay/node';
import {
  getPletopay,
  handleWebhook,
  pletopayPagesConfig,
  pletopayPagesWebhookHandler,
  pletopayWebhookHandler,
  resetPletopay,
} from '../src/server';

const dir = new URL('./fixtures/', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('webhook-signature.json', dir), 'utf8')) as {
  secret: string;
  header_wrong: string;
  event_id: string;
};
const payload = readFileSync(new URL('webhook-payload.json', dir), 'utf8');
const sign = (body = payload, secret = fixture.secret) => generateTestHeaderString({ payload: body, secret });

describe('getPletopay', () => {
  beforeEach(() => {
    resetPletopay();
    vi.stubEnv('PLETOPAY_SECRET_KEY', 'sk_test_abc_def');
    vi.stubEnv('PLETOPAY_API_URL', 'http://api.test');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('builds one client per process from the environment', () => {
    const a = getPletopay();
    expect(a.mode).toBe('test');
    expect(a.baseUrl).toBe('http://api.test');
    expect(getPletopay()).toBe(a);
    const b = getPletopay({ secretKey: 'sk_live_abc_def' });
    expect(b).not.toBe(a);
    expect(b.mode).toBe('live');
  });
});

describe('handleWebhook', () => {
  it('verifies and dispatches to the typed, wildcard and onEvent handlers', async () => {
    const calls: string[] = [];
    const outcome = await handleWebhook(payload, sign(), {
      secret: fixture.secret,
      handlers: {
        'payment.succeeded': async (e) => calls.push(`typed:${e.data.object.amount_received}`),
        'transfer.failed': () => calls.push('wrong'),
        '*': (e) => calls.push(`any:${e.type}`),
      },
      onEvent: (e) => calls.push(`on:${e.id}`),
    });
    expect(outcome).toMatchObject({ status: 200, body: { received: true } });
    expect(outcome.event?.id).toBe(fixture.event_id);
    expect(calls).toEqual(['typed:5000000', 'any:payment.succeeded', `on:${fixture.event_id}`]);
  });

  it('answers 400 for a bad signature and never runs handlers', async () => {
    const onError = vi.fn();
    const handler = vi.fn();
    const outcome = await handleWebhook(payload, fixture.header_wrong, {
      secret: fixture.secret,
      handlers: { '*': handler },
      onError,
    });
    expect(outcome.status).toBe(400);
    expect(outcome.body).toMatchObject({ error: expect.stringMatching(/No signature found|tolerance/) });
    expect(handler).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), null);
    expect((await handleWebhook(payload, undefined, { secret: fixture.secret })).status).toBe(400);
  });

  it('handler failures answer 500 (retry) by default, 200 with onHandlerError: ack', async () => {
    const onError = vi.fn();
    const boom = { '*': () => Promise.reject(new Error('db down')) };
    expect((await handleWebhook(payload, sign(), { secret: fixture.secret, handlers: boom, onError })).status).toBe(
      500,
    );
    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ id: fixture.event_id }));
    expect(
      (await handleWebhook(payload, sign(), { secret: fixture.secret, handlers: boom, onHandlerError: 'ack' })).status,
    ).toBe(200);
  });

  it('reads the secret from the environment and explains when it is missing', async () => {
    vi.stubEnv('PLETOPAY_WEBHOOK_SECRET', fixture.secret);
    expect((await handleWebhook(payload, sign())).status).toBe(200);
    vi.unstubAllEnvs();
    delete process.env.PLETOPAY_WEBHOOK_SECRET;
    await expect(handleWebhook(payload, sign())).rejects.toThrow(/No webhook secret/);
  });
});

describe('App Router handler', () => {
  it('turns a Request into a Response', async () => {
    const seen: string[] = [];
    const POST = pletopayWebhookHandler({
      secret: fixture.secret,
      handlers: { 'payment.succeeded': (e) => seen.push(e.data.object.reference) },
    });
    const ok = await POST(
      new Request('http://app.test/api/webhooks/pletopay', {
        method: 'POST',
        body: payload,
        headers: { 'x-pletopay-signature': sign(), 'content-type': 'application/json' },
      }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ received: true });
    expect(seen).toEqual(['ORDER-12345']);
    const bad = await POST(
      new Request('http://app.test/api/webhooks/pletopay', {
        method: 'POST',
        body: payload.replace('5000000', '5000001'),
        headers: { 'x-pletopay-signature': sign() },
      }),
    );
    expect(bad.status).toBe(400);
  });
});

describe('Pages Router handler', () => {
  function fakeRes() {
    const res = { statusCode: 0, body: undefined as unknown, headers: {} as Record<string, string> };
    const api = {
      status: (code: number) => {
        res.statusCode = code;
        return api;
      },
      json: (body: unknown) => {
        res.body = body;
      },
      setHeader: (name: string, value: string) => {
        res.headers[name] = value;
      },
    };
    return { res, api };
  }
  const request = (body: string, headers: Record<string, string>, method = 'POST') =>
    Object.assign(Readable.from([Buffer.from(body)]), { headers, method });

  it('reads the raw stream, verifies and answers', async () => {
    const handler = pletopayPagesWebhookHandler({ secret: fixture.secret, handlers: { '*': () => undefined } });
    const good = fakeRes();
    await handler(request(payload, { 'x-pletopay-signature': sign() }), good.api);
    expect(good.res).toMatchObject({ statusCode: 200, body: { received: true } });
    const bad = fakeRes();
    await handler(request(payload, { 'x-pletopay-signature': fixture.header_wrong }), bad.api);
    expect(bad.res.statusCode).toBe(400);
    const wrongMethod = fakeRes();
    await handler(request(payload, {}, 'GET'), wrongMethod.api);
    expect(wrongMethod.res).toMatchObject({ statusCode: 405, headers: { Allow: 'POST' } });
    expect(pletopayPagesConfig).toEqual({ api: { bodyParser: false } });
  });
});
