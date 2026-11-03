import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createApp, toNodeListener } from 'h3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateTestHeaderString } from '@pletopay/node';

vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({
    pletopay: {
      secretKey: 'sk_test_abc_def',
      apiUrl: 'http://127.0.0.1:1',
      webhookSecret: 'whsec_sdk_fixture_secret_0123456789',
    },
  }),
}));

const { definePletopayWebhookHandler, usePletopayServer } = await import('../src/runtime/server/utils/pletopay');
const fixture = JSON.parse(readFileSync(new URL('./webhook-signature.json', import.meta.url), 'utf8')) as {
  secret: string;
  header_wrong: string;
};
const payload = readFileSync(new URL('./webhook-payload.json', import.meta.url), 'utf8');

describe('server utils (h3, no Nuxt build)', () => {
  const calls: string[] = [];
  let url = '';
  const server = createServer(
    toNodeListener(
      createApp()
        .use(
          '/ok',
          definePletopayWebhookHandler({
            handlers: { 'payment.succeeded': (e) => calls.push(e.data.object.reference) },
          }),
        )
        .use('/boom', definePletopayWebhookHandler({ handlers: { '*': () => Promise.reject(new Error('db down')) } }))
        .use(
          '/ack',
          definePletopayWebhookHandler({
            onHandlerError: 'ack',
            handlers: { '*': () => Promise.reject(new Error('db down')) },
          }),
        ),
    ),
  );
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address === 'object' && address) url = `http://127.0.0.1:${address.port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const post = (path: string, body: string, signature: string) =>
    fetch(`${url}${path}`, {
      method: 'POST',
      body,
      headers: { 'x-pletopay-signature': signature, 'content-type': 'application/json' },
    });

  it('verifies, dispatches, and maps failures to 400 / 500 / 200', async () => {
    const sig = generateTestHeaderString({ payload, secret: fixture.secret });
    expect((await post('/ok', payload, sig)).status).toBe(200);
    expect(calls).toEqual(['ORDER-12345']);
    expect((await post('/ok', payload, fixture.header_wrong)).status).toBe(400);
    expect((await post('/boom', payload, sig)).status).toBe(500);
    expect((await post('/ack', payload, sig)).status).toBe(200);
  });

  it('usePletopayServer memoises the client from runtime config', () => {
    const client = usePletopayServer();
    expect(client.mode).toBe('test');
    expect(client.baseUrl).toBe('http://127.0.0.1:1');
    expect(usePletopayServer()).toBe(client);
  });
});
