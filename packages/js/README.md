# @pletopay/js

Loads [pletopay.js](https://docs.pletopay.com/checkout/popup), the Pletopay checkout popup, in the browser and returns a typed client. It is what `@pletopay/react`, `@pletopay/vue`, `@pletopay/next` and `@pletopay/nuxt` build on; use it directly from any other framework or plain JavaScript.

The script itself is always served by Pletopay (`https://checkout.pletopay.com/v1/pletopay.js`), so the popup contract can never go stale inside an npm package. This package only injects the tag once, waits for it, and hands you `window.Pletopay` with types.

## Install

```bash
npm install @pletopay/js
```

## Use

```ts
import { createPletopay } from '@pletopay/js';

const pletopay = await createPletopay('pk_test_YOUR_PUBLISHABLE_KEY'); // null on the server

document.querySelector('#pay')?.addEventListener('click', async () => {
  // 1. Ask your server for a checkout session (it calls Pletopay with your secret key).
  const { token } = await fetch('/api/checkout-session', { method: 'POST' }).then((r) => r.json());

  // 2. Open the popup. The amount was fixed on your server.
  pletopay?.checkout({
    session: token,
    onSuccess: ({ session }) => {
      // Pletopay saw the transfer. Confirm on your server before fulfilling.
      window.location.href = `/orders/thank-you?session=${session}`;
    },
    onPending: () => console.log('Transfer received, confirming…'),
    onError: (error) => console.error(error.code, error.message),
    onClose: ({ reason }) => console.log('Checkout closed:', reason),
  });
});
```

Only publishable keys (`pk_…`) belong in the browser; sessions are created on your server with a secret key (`@pletopay/node`, `pletopay` for Python, or any HTTP client).

## API

- `loadPletopay(options?)`: injects the script once (concurrent calls share it, a failed load is retried on the next call) and resolves to the `Pletopay` factory, or `null` outside a browser.
- `createPletopay(publicKey, options?)`: `loadPletopay` plus `Pletopay({ publicKey, checkoutUrl })`.
- `options`: `checkoutUrl` (default `https://checkout.pletopay.com`; https, or http for localhost), `timeoutMs` (default 30 000), `nonce` (CSP nonce for the tag).
- `PletopayLoadError` with `code` `script_error` | `timeout` | `no_factory` | `invalid_options`.
- `createCheckoutController({ getClient })`: the framework-agnostic state machine (`idle → opening → open → pending → complete | closed | error`) the React hook and the Vue composable render. Use it to build your own integration.
- Types of the popup client: `PletopayClient`, `CheckoutOptions`, `SuccessResult`, `PendingResult`, `CloseResult`, `PletopayError`, … (vendored from pletopay.js by `pnpm sync:types`).

`onSuccess` is a hint, not proof of payment: confirm with the `checkout.session.completed` webhook or by retrieving the session on your server before fulfilling.

## License

[MIT](LICENSE)
