# @pletopay/next

Pletopay for Next.js 14, 15 and 16: the React checkout components from `@pletopay/react`, plus server helpers that keep your secret key on the server: a memoised client over `@pletopay/node`, an App Router webhook route handler and a Pages Router API route handler, both verifying `X-PletoPay-Signature` over the raw body.

## Install

```bash
npm install @pletopay/next
```

Environment variables (server only unless noted):

```bash
PLETOPAY_SECRET_KEY=sk_test_…              # server
PLETOPAY_WEBHOOK_SECRET=whsec_…            # server
NEXT_PUBLIC_PLETOPAY_PUBLISHABLE_KEY=pk_test_…   # browser
```

## Checkout (client)

`@pletopay/next` re-exports `@pletopay/react` as client components (`'use client'` is in the bundle), so the provider can sit under the root layout:

```tsx
// app/providers.tsx
'use client';
import { PletopayProvider } from '@pletopay/next';

export function Providers({ children }: { children: React.ReactNode }) {
  return <PletopayProvider publicKey={process.env.NEXT_PUBLIC_PLETOPAY_PUBLISHABLE_KEY!}>{children}</PletopayProvider>;
}
```

```tsx
// app/checkout/pay-button.tsx
'use client';
import { PletopayCheckoutButton } from '@pletopay/next';

export function PayButton({ orderId }: { orderId: string }) {
  const fetchSession = async () => {
    const res = await fetch('/api/checkout-session', { method: 'POST', body: JSON.stringify({ orderId }) });
    return (await res.json()).token as string;
  };
  return (
    <PletopayCheckoutButton
      session={fetchSession}
      onSuccess={({ session }) => (window.location.href = `/orders/${orderId}/thanks?session=${session}`)}
    />
  );
}
```

See the [`@pletopay/react` README](https://github.com/pletopay/pletopay-sdk-web/tree/main/packages/react#readme) for `usePletopayCheckout` and the full props.

## Server

### Create sessions

```ts
// app/api/checkout-session/route.ts
import { getPletopay } from '@pletopay/next/server';

export async function POST(request: Request) {
  const { orderId } = await request.json();
  const session = await getPletopay().checkout.sessions.create(
    { amount: 250000, currency: 'NGN', reference: orderId, success_url: `https://shop.test/orders/${orderId}/thanks` },
    { idempotencyKey: `checkout-${orderId}` },
  );
  return Response.json({ token: session.token });
}
```

`getPletopay()` builds one `Pletopay` client per process from the environment (or the options you pass) and exposes the whole Node SDK: payments, transfers, refunds, webhooks management, … The module also re-exports everything from `@pletopay/node`.

### Webhooks, App Router

```ts
// app/api/webhooks/pletopay/route.ts
import { pletopayWebhookHandler } from '@pletopay/next/server';

export const POST = pletopayWebhookHandler({
  handlers: {
    'payment.succeeded': async (event) => fulfil(event.data.object.reference), // typed as Payment
    'checkout.session.completed': async (event) => markPaid(event.data.object.id),
    '*': async (event) => audit(event),
  },
});
```

### Webhooks, Pages Router

```ts
// pages/api/webhooks/pletopay.ts
import { pletopayPagesConfig, pletopayPagesWebhookHandler } from '@pletopay/next/server';

export const config = pletopayPagesConfig; // bodyParser: false, so the raw bytes reach the verifier
export default pletopayPagesWebhookHandler({
  handlers: { 'payment.succeeded': async (event) => fulfil(event.data.object.reference) },
});
```

Both handlers verify the signature (400 when it is missing, stale or wrong; no handler runs), then run the typed handler, `'*'` and `onEvent` **before** responding, as serverless functions require. A throwing handler answers 500 so Pletopay retries the delivery; set `onHandlerError: 'ack'` to answer 200 and only report through `onError`. Deliveries are at least once: de-duplicate on `event.id`. `handleWebhook(rawBody, signature, options)` is the framework-agnostic core if you need a custom route.

## License

[MIT](LICENSE)
