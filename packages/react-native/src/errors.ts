export type PletopayCheckoutErrorCode =
  | 'resource_missing'
  | 'not_found'
  | 'checkout_session_not_open'
  | 'merchant_unavailable'
  | 'rate_limited'
  | 'service_unavailable'
  | 'network_error'
  | 'invalid_session'
  | 'timeout'
  | 'unknown'
  | (string & {});

/** A checkout API or network failure. `retryable` says whether the same call can simply be retried. */
export class PletopayCheckoutError extends Error {
  override name = 'PletopayCheckoutError';
  constructor(
    readonly code: PletopayCheckoutErrorCode,
    message: string,
    readonly status: number | undefined = undefined,
    readonly retryable = false,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
