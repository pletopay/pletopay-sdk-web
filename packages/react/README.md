# @pletopay/react

Pletopay checkout for React 18 and 19: a provider that loads [pletopay.js](https://docs.pletopay.com/checkout/popup) once, a hook with the checkout state, and a ready-made button. Works with Vite, Create React App, Remix and Next.js (see `@pletopay/next` for server helpers).

## Install

```bash
npm install @pletopay/react
```

## Use

```tsx
import { PletopayProvider, PletopayCheckoutButton } from '@pletopay/react';

export function App() {
  return (
    <PletopayProvider publicKey={import.meta.env.VITE_PLETOPAY_PUBLISHABLE_KEY}>
      <Checkout orderId="ORDER-123" />
    </PletopayProvider>
  );
}

function Checkout({ orderId }: { orderId: string }) {
  // Your server creates the session with its secret key and returns the token.
  const fetchSession = async () => {
    const res = await fetch('/api/checkout-session', { method: 'POST', body: JSON.stringify({ orderId }) });
    const { token } = await res.json();
    return token as string;
  };
  return (
    <PletopayCheckoutButton
      session={fetchSession}
      onSuccess={({ session }) => (window.location.href = `/orders/${orderId}/thanks?session=${session}`)}
      onError={(error) => alert(error.message)}
    >
      {(state) => (state.busy ? 'Opening…' : 'Pay with bank transfer')}
    </PletopayCheckoutButton>
  );
}
```

Only the publishable key (`pk_…`) goes in the browser. `onSuccess` means Pletopay saw the transfer; confirm with the `checkout.session.completed` webhook or by retrieving the session on your server before fulfilling.

## API

### `<PletopayProvider>`

| Prop                 |                                                             |
| -------------------- | ----------------------------------------------------------- |
| `publicKey`          | `pk_test_…` / `pk_live_…` (required)                        |
| `checkoutUrl`        | default `https://checkout.pletopay.com`                     |
| `loadOnMount`        | load the script on mount (default) or at the first checkout |
| `timeoutMs`, `nonce` | script loading options                                      |

Safe to render on the server: the script loads in the browser only.

### `usePletopayCheckout()`

Returns the checkout state plus actions:

- state: `status` (`idle` `opening` `open` `pending` `complete` `closed` `error`), `busy`, `isOpen`, `result` (`{ session, status: 'complete' }`), `pending`, `closed` (`{ reason }`), `error`.
- `open(session, callbacks?)`: `session` is a token, a hosted URL, or a function that fetches the token. Callbacks: `onSuccess`, `onPending`, `onError`, `onClose`, `appearance`.
- `close()`, `reset()`, `redirect({ session })` (hosted page instead of the popup).

```tsx
const checkout = usePletopayCheckout();
<button disabled={checkout.busy} onClick={() => checkout.open(fetchSession, { onSuccess })}>
  Pay
</button>;
{
  checkout.status === 'pending' && <p>Transfer received, confirming…</p>;
}
{
  checkout.error && <p role="alert">{checkout.error.message}</p>;
}
```

### `<PletopayCheckoutButton>`

A `<button type="button">` wired to the hook: `session`, the callbacks above, `onClick` (return `false` to cancel), `disabled`, any other button props, and `children` as a node or a function of the checkout state. It sets `aria-busy` and `data-pletopay-status` while a checkout runs.

### `usePletopay()`

The shared client: `{ client, status: 'idle' | 'loading' | 'ready' | 'error', error, getClient(), reload() }`.

## License

[MIT](LICENSE)
