import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { $fetch, setup } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';
import { generateTestHeaderString } from '@pletopay/node';

const fixture = JSON.parse(readFileSync(new URL('./webhook-signature.json', import.meta.url), 'utf8')) as {
  secret: string;
  header_wrong: string;
  event_id: string;
};
const payload = readFileSync(new URL('./webhook-payload.json', import.meta.url), 'utf8');

await setup({ rootDir: fileURLToPath(new URL('./fixtures/basic', import.meta.url)), server: true, browser: false });

describe('@pletopay/nuxt (built fixture app)', () => {
  it('installs the plugin, auto-imports the composables and registers the button', async () => {
    const html = await $fetch<string>('/');
    expect(html).toContain('<p id="key">pk_test_fixture_key</p>');
    expect(html).toContain('<p id="status">idle</p>'); // nothing loads during SSR
    expect(html).toContain('<p id="checkout">idle</p>');
    expect(html).toMatch(/<button[^>]*id="pay"[^>]*type="button"[^>]*>Pay with bank transfer<\/button>/);
    expect(html).not.toContain('sk_test_'); // the secret never reaches the page
  });

  it('usePletopayServer builds one client from runtime config', async () => {
    const info = await $fetch<{ mode: string; baseUrl: string; same: boolean }>('/api/client');
    expect(info).toEqual({ mode: 'test', baseUrl: 'http://127.0.0.1:1', same: true });
  });

  it('definePletopayWebhookHandler verifies the raw body and dispatches', async () => {
    const headers = {
      'x-pletopay-signature': generateTestHeaderString({ payload, secret: fixture.secret }),
      'content-type': 'application/json',
    };
    const ok = await $fetch<{ received: boolean }>('/api/webhooks/pletopay', {
      method: 'POST',
      body: payload,
      headers,
    });
    expect(ok).toEqual({ received: true });
    expect(await $fetch<string[]>('/api/seen')).toEqual(['payment.succeeded:ORDER-12345', `*:${fixture.event_id}`]);

    await expect(
      $fetch('/api/webhooks/pletopay', {
        method: 'POST',
        body: payload,
        headers: { ...headers, 'x-pletopay-signature': fixture.header_wrong },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      $fetch('/api/webhooks/pletopay', { method: 'POST', body: payload.replace('5000000', '5000001'), headers }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await $fetch<string[]>('/api/seen')).toHaveLength(2); // nothing ran for the rejected deliveries
  });
});
