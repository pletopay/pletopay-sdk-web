# @pletopay/nuxt

Pletopay for Nuxt 3.13+ and 4: a module that configures the checkout popup from runtime config, auto-imports `usePletopayCheckout` and `<PletopayCheckoutButton>` (from `@pletopay/vue`), and adds Nitro helpers for a server client and verified webhooks (over `@pletopay/node`).

## Install

```bash
npm install @pletopay/nuxt
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@pletopay/nuxt'],
  pletopay: {
    publicKey: 'pk_test_…', // or NUXT_PUBLIC_PLETOPAY_PUBLIC_KEY
    // server only; prefer the environment:
    // NUXT_PLETOPAY_SECRET_KEY, NUXT_PLETOPAY_WEBHOOK_SECRET, NUXT_PLETOPAY_API_URL
  },
});
```

Options: `publicKey`, `checkoutUrl` (default `https://checkout.pletopay.com`), `loadOnMount` (default true), `secretKey`, `webhookSecret`, `apiUrl`. The public ones land in `runtimeConfig.public.pletopay`, the server ones in `runtimeConfig.pletopay`, so every `NUXT_*` environment override works.

## Checkout (browser)

```vue
<script setup lang="ts">
const props = defineProps<{ orderId: string }>();
async function fetchSession() {
  const { token } = await $fetch<{ token: string }>('/api/checkout-session', {
    method: 'POST',
    body: { orderId: props.orderId },
  });
  return token;
}
</script>

<template>
  <PletopayCheckoutButton
    :session="fetchSession"
    @success="({ session }) => navigateTo(`/orders/${orderId}/thanks?session=${session}`)"
  >
    Pay with bank transfer
  </PletopayCheckoutButton>
</template>
```

`usePletopay()` and `usePletopayCheckout()` are auto-imported; see the [`@pletopay/vue` README](https://github.com/pletopay/pletopay-sdk-web/tree/main/packages/vue#readme) for the state and options. pletopay.js loads in the browser only; server rendering never touches it.

## Server (Nitro)

```ts
// server/api/checkout-session.post.ts
export default defineEventHandler(async (event) => {
  const { orderId } = await readBody<{ orderId: string }>(event);
  const session = await usePletopayServer().checkout.sessions.create(
    { amount: 250000, currency: 'NGN', reference: orderId, success_url: `https://shop.test/orders/${orderId}/thanks` },
    { idempotencyKey: `checkout-${orderId}` },
  );
  return { token: session.token };
});
```

```ts
// server/api/webhooks/pletopay.post.ts
export default definePletopayWebhookHandler({
  handlers: {
    'payment.succeeded': async (event) => fulfil(event.data.object.reference), // typed as Payment
    '*': async (event) => audit(event),
  },
});
```

`usePletopayServer()` builds one `@pletopay/node` client per process from runtime config. `definePletopayWebhookHandler()` reads the raw body, verifies `X-PletoPay-Signature` (400 when missing, stale or wrong; no handler runs), then runs the typed handler, `'*'` and `onEvent` before responding. A throwing handler answers 500 so Pletopay retries; `onHandlerError: 'ack'` answers 200 and only reports through `onError`. Deliveries are at least once: de-duplicate on `event.id`.

## License

[MIT](LICENSE)
