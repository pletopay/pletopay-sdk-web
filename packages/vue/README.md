# @pletopay/vue

Pletopay checkout for Vue 3: a plugin that loads [pletopay.js](https://docs.pletopay.com/checkout/popup) once, composables with the checkout state, and a ready-made button. For Nuxt, `@pletopay/nuxt` wraps this package with runtime config, auto-imports and server helpers.

## Install

```bash
npm install @pletopay/vue
```

## Use

```ts
// main.ts
import { createApp } from 'vue';
import { createPletopayPlugin } from '@pletopay/vue';

createApp(App)
  .use(createPletopayPlugin({ publicKey: import.meta.env.VITE_PLETOPAY_PUBLISHABLE_KEY }))
  .mount('#app');
```

```vue
<script setup lang="ts">
import { PletopayCheckoutButton } from '@pletopay/vue';

const props = defineProps<{ orderId: string }>();

// Your server creates the session with its secret key and returns the token.
async function fetchSession() {
  const res = await fetch('/api/checkout-session', {
    method: 'POST',
    body: JSON.stringify({ orderId: props.orderId }),
  });
  return (await res.json()).token as string;
}
function onSuccess({ session }: { session: string }) {
  window.location.href = `/orders/${props.orderId}/thanks?session=${session}`;
}
</script>

<template>
  <PletopayCheckoutButton :session="fetchSession" @success="onSuccess" @error="(e) => alert(e.message)">
    <template #default="{ state }">{{ state.busy ? 'Opening…' : 'Pay with bank transfer' }}</template>
  </PletopayCheckoutButton>
</template>
```

Only the publishable key (`pk_…`) goes in the browser. `success` means Pletopay saw the transfer; confirm with the `checkout.session.completed` webhook or by retrieving the session on your server before fulfilling.

## API

### `createPletopayPlugin(options)`

`publicKey` (required), `checkoutUrl` (default `https://checkout.pletopay.com`), `loadOnMount` (default true), `timeoutMs`, `nonce`. Safe with SSR: the script loads in the browser only. The instance is also available as `this.$pletopay`.

### `usePletopayCheckout()`

```ts
const { state, open, close, reset, redirect } = usePletopayCheckout();
```

`state` is a shallow ref of `{ status, busy, isOpen, result, pending, closed, error }` with `status` one of `idle` `opening` `open` `pending` `complete` `closed` `error`. `open(session, callbacks?)` takes a token, a hosted URL or a function that fetches the token, plus `onSuccess`, `onPending`, `onError`, `onClose`, `appearance`. `redirect({ session })` sends the customer to the hosted page instead.

### `<PletopayCheckoutButton>`

Props `session` (required), `disabled`, `appearance`; emits `success`, `pending`, `error`, `close`; default slot receives `{ state }`. Renders a `<button type="button">` that is disabled while a checkout runs and carries `aria-busy` and `data-pletopay-status`.

### `usePletopay()`

The shared client: `{ client, status, error, getClient(), reload() }` (refs).

## License

[MIT](LICENSE)
