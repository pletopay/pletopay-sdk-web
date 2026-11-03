// Vendored from the pletopay.js source (pletopay-checkout/sdk/src/types.ts) by scripts/sync-types.mjs.
// Do not edit: run `pnpm sync:types`.

/**
 * Public types of the Pletopay browser SDK (pletopay.js). Self-contained on purpose: this file is
 * what ships as pletopay.d.ts. Keep the unions in step with shared/messages.ts (a unit test checks).
 */

export interface PletopayOptions {
  /** Your publishable key (`pk_test_…` or `pk_live_…`), from Settings → Developers in the dashboard. */
  publicKey: string;
  /**
   * The Pletopay checkout origin, e.g. `https://checkout.pletopay.com`. Inferred from the script
   * URL when the SDK is loaded with a `<script>` tag; required when it is bundled.
   */
  checkoutUrl?: string;
}

export type PaymentStatus = 'processing' | 'under_review';

export interface SuccessResult {
  /** The checkout session token you opened. Verify server-side before fulfilling. */
  session: string;
  status: 'complete';
}

export interface PendingResult {
  session: string;
  /** A transfer arrived and is being confirmed or reviewed. Not yet paid. */
  paymentStatus: PaymentStatus;
}

export type CloseReason = 'user' | 'complete' | 'expired' | 'error';

export interface CloseResult {
  reason: CloseReason;
}

export type PletopayErrorCode =
  | 'invalid_options'
  | 'embed_timeout'
  | 'embed_blocked'
  | 'publishable_key_invalid'
  | 'origin_not_allowed'
  | 'checkout_session_mismatch'
  | 'livemode_mismatch'
  | 'not_found'
  | 'checkout_session_not_open'
  | 'merchant_unavailable'
  | 'rate_limited'
  | 'service_unavailable'
  | 'network_error'
  | 'unknown';

export interface PletopayError {
  code: PletopayErrorCode;
  message: string;
  /** The same call can be retried as is. */
  retryable: boolean;
}

export interface CheckoutOptions {
  /**
   * The checkout session to open: its `token`, or its hosted `url`, from
   * `POST /api/v1/checkout/sessions` on your server. Never create sessions in the browser.
   */
  session: string;
  /**
   * The session reached `complete` according to Pletopay. Confirm server-side (the
   * `checkout.session.completed` webhook or `GET /api/v1/checkout/sessions/{id}`) before fulfilling.
   * When omitted, the SDK sends the customer to the session's `success_url` instead.
   */
  onSuccess?: (result: SuccessResult) => void;
  /** A transfer was received and is being confirmed. The popup stays open. */
  onPending?: (result: PendingResult) => void;
  /** Checkout could not open or failed. The popup is closed afterwards. */
  onError?: (error: PletopayError) => void;
  /** The popup closed, for any reason. Closing never cancels a transfer already sent. */
  onClose?: (result: CloseResult) => void;
  appearance?: {
    /** Stacking order of the overlay. Default 2147483000. */
    zIndex?: number;
  };
}

export interface CheckoutHandle {
  /** Close the popup programmatically (asks the customer to confirm while a transfer may be in flight). */
  close(): void;
}

export interface RedirectOptions {
  /** The session `token` or hosted `url`. */
  session: string;
}

export interface PletopayClient {
  /**
   * Open the checkout popup over the page. Returns `null` when a popup is already open (a second
   * click is ignored) or when the options are invalid (then `onError` is called synchronously).
   */
  checkout(options: CheckoutOptions): CheckoutHandle | null;
  /** Send the customer to the hosted checkout page instead of opening the popup. */
  redirectToCheckout(options: RedirectOptions): void;
  /** Close the open popup, if any. */
  close(): void;
  isOpen(): boolean;
  /** The SDK version, e.g. "1.0.0". */
  readonly version: string;
}
