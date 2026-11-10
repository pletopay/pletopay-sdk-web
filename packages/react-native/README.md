# @pletopay/react-native

Pletopay checkout for React Native and Expo. Your server creates a checkout session with its secret key; the app shows the hosted bank-transfer checkout in a WebView and knows when the customer has paid. No key of any kind ships in the app: the session token is all the checkout API needs.

- `<PletopayCheckout>`: the hosted page in a WebView. Completion is detected by intercepting the redirect to your `success_url` (confirmed with the checkout API) **and** by polling the session, so it works with or without a `success_url`, and with or without polling.
- `PletopayCheckoutClient` and `useCheckoutSession()`: a headless client for the token-authenticated checkout API, for a fully native screen (account details, countdown, status).

## Install

```bash
npm install @pletopay/react-native react-native-webview
# Expo: npx expo install react-native-webview
```

Peer dependencies: `react`, `react-native` 0.72+, `react-native-webview` 13+.

## Checkout in a WebView

```tsx
import { PletopayCheckout } from '@pletopay/react-native';

export function CheckoutScreen({ route, navigation }) {
  const { token } = route.params; // from your server: POST /api/v1/checkout/sessions → data.token

  return (
    <PletopayCheckout
      session={token}
      onSuccess={({ session }) => navigation.replace('Thanks', { session })} // confirm server-side before fulfilling
      onCancel={() => navigation.goBack()}
      onExpired={() => navigation.replace('Expired')}
      onError={(error) => Alert.alert('Checkout unavailable', error.message)}
      onSessionChange={(s) => s.payment_status === 'processing' && setBanner('Transfer received, confirming…')}
    />
  );
}
```

Props: `session` (token or hosted URL), `onSuccess`, `onCancel`, `onExpired`, `onError`, `onSessionChange`, `poll` (default true), `pollIntervalMs` (default 4000, minimum 2000), `style`, `renderLoading`, `webViewProps` (anything for the underlying `WebView`, e.g. `userAgent`), `client`.

The component never navigates the WebView to your `success_url` or `cancel_url`: it intercepts those requests and calls your callbacks instead, so your app decides what to show. `onSuccess` fires once, whichever signal arrives first. Leaving the screen never cancels a transfer the customer already sent; if the money arrives later the session still completes and your server receives `checkout.session.completed`.

A redirect is never taken as proof on its own. The checkout API only reveals a session's `success_url` once the session is complete, so when the page leaves the checkout origin the component blocks the navigation, reads the session once and fires `onSuccess` only if the API says `complete` and the address is the session's `success_url`. This is what makes `poll={false}` work. Any other address is handled as before (`cancel_url` calls `onCancel`; other links open in the system browser or mail app), and if that one read fails the error goes to `onError` and the address is treated as an ordinary link.

A session can stay `open` for a while after its `expires_at`: a transfer sent just before the deadline is still accepted, and the session then ends as `complete` or `expired`. Polling therefore continues past `expires_at` (every 15 seconds from then on) so that `onExpired`, or a late `onSuccess`, is reported. It gives up with `onError` (`timeout`) only if the session is still `open` 30 minutes after `expires_at`.

## Headless: a native checkout screen

```tsx
import { useCheckoutSession } from '@pletopay/react-native';

export function NativeCheckout({ token }: { token: string }) {
  const { status, session, error, open } = useCheckoutSession(token, { openOnMount: true }); // issues the account details

  if (status === 'loading') return <ActivityIndicator />;
  if (status === 'error') return <Text>{error?.message}</Text>;
  if (status === 'complete') return <Text>Paid, thank you</Text>;
  if (status === 'expired') return <Text>This checkout has expired</Text>;

  const transfer = session!.bank_transfer!;
  return (
    <View>
      <Text>Transfer ₦{(session!.amount / 100).toLocaleString()} to</Text>
      <Text selectable>{transfer.account_number}</Text>
      <Text>
        {transfer.account_name} · {transfer.bank_name}
      </Text>
      <Text>Expires {new Date(transfer.expires_at).toLocaleTimeString()}</Text>
      {session!.payment_status === 'processing' && <Text>Transfer received, confirming…</Text>}
    </View>
  );
}
```

The hook fetches the session, optionally opens it (`openOnMount`, idempotent) and polls while it is `open` (`poll`, `intervalMs`), so `status` becomes `complete` when Pletopay confirms the transfer. `status` can stay `open` for some minutes after `expires_at` before it becomes `expired` (or `complete`, for a transfer sent at the last moment); show the customer a "confirming" state rather than an error once your countdown reaches zero. `session.bank_transfer.bank_name` is what the customer needs to send the money.

`PletopayCheckoutClient` underneath: `getSession(token)`, `openSession(token)`, `pollSession(token, { intervalMs, signal, onUpdate, initial, timeoutMs })`, `hostedUrl(token)`, `resolveToken(tokenOrUrl)`. `pollSession` resolves when the session is `complete` or `expired`; it polls every 15 seconds once `expires_at` has passed and rejects with `timeout` 30 minutes after it (or after your `timeoutMs`). Errors are `PletopayCheckoutError` with `code` (the API's code, e.g. `resource_missing` for an unknown token, `checkout_session_not_open`, `rate_limited`, `service_unavailable`; or the SDK's `network_error`, `timeout`, `invalid_session`), `status` and `retryable`.

Wrap your app in `<PletopayProvider apiUrl checkoutUrl>` only to point at a non-production environment; the defaults are the production origins.

## Confirming payment

A success callback is a hint, not proof. Fulfil from your server: handle the `checkout.session.completed` webhook (signature verified) or retrieve the session with your secret key and check `status === "complete"`.

## License

[MIT](LICENSE)
