# Security

Please report vulnerabilities in these SDKs or in the Pletopay API privately to security@pletopay.com. Do not open a public issue. We acknowledge reports within two business days.

## Using the SDKs safely

- Only publishable keys (`pk_…`) belong in browsers and apps. Secret keys (`sk_…`) stay on your server; create checkout sessions there.
- A success callback or a redirect to your `success_url` is a hint, not proof of payment. Confirm with the `checkout.session.completed` webhook (signature verified) or by retrieving the session on your server before fulfilling.
- pletopay.js is always loaded from Pletopay's checkout origin; pass a CSP `nonce` if your policy requires one, and allow `https://checkout.pletopay.com` in `script-src`, `frame-src` and `connect-src`.
