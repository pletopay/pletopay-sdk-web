/** Shapes of the token-authenticated checkout API (`/checkout/v1/sessions/{token}`), as a customer sees them. */

export type CheckoutSessionStatus = 'open' | 'complete' | 'expired';

export type PaymentStatus =
  | 'created'
  | 'pending'
  | 'processing'
  | 'under_review'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'reversed'
  | 'partially_refunded'
  | 'refunded';

export interface PublicMerchant {
  /** Trading name shown to the customer. */
  name: string;
  /** Button/accent colour; null = default. */
  brand_color: string | null;
  support_email: string | null;
  support_url: string | null;
}

/** The account the customer transfers to. Issued when the session is opened. */
export interface BankTransferDetails {
  account_number: string;
  account_name: string;
  bank_name: string;
  bank_code: string;
  /** Minor units (kobo). */
  amount: number;
  expires_at: string;
}

export interface PublicCheckoutSession {
  object: 'checkout_session';
  livemode: boolean;
  status: CheckoutSessionStatus;
  merchant: PublicMerchant;
  /** Minor units (kobo). */
  amount: number;
  currency: 'NGN' | (string & {});
  description: string | null;
  /** Status of the payment behind the session; null until the customer opens the page. */
  payment_status: PaymentStatus | null;
  bank_transfer: BankTransferDetails | null;
  success_url: string | null;
  cancel_url: string | null;
  expires_at: string;
}

export interface CheckoutSuccess {
  /** The session token. Verify server-side (webhook or retrieve) before fulfilling. */
  session: string;
  status: 'complete';
}
