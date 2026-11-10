---
'@pletopay/react-native': patch
---

Fixed: `<PletopayCheckout>` now reports a completed payment when the hosted page redirects to your `success_url`, including with `poll={false}`. The checkout API only reveals a session's `success_url` once it is complete, so the redirect was not recognised: `onSuccess` never fired without polling, and your `success_url` opened in the system browser instead. The component now blocks the redirect, reads the session once and calls `onSuccess` only if the API says `complete`; if that read fails, `onError` is called and the address is handled as an ordinary link.

Fixed: polling no longer gives up one minute after the session's `expires_at`. A session can stay `open` for a while after `expires_at` and can still complete, so `pollSession`, `useCheckoutSession` and `<PletopayCheckout>` keep polling (every 15 seconds from `expires_at` on) and report `onExpired`, or a late `onSuccess`, instead of `onError` with `timeout`. The default deadline is now 30 minutes after `expires_at`; an explicit `timeoutMs` still wins. The two values are exported as `POST_EXPIRY_POLL_INTERVAL_MS` and `POLL_DEADLINE_AFTER_EXPIRY_MS`.
