import { useCallback, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { CheckoutCallbacks, CheckoutState, SessionSource } from '@pletopay/js';
import { usePletopayCheckout } from './hooks';

export interface PletopayCheckoutButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onError' | 'onClick' | 'children'>, CheckoutCallbacks {
  /** The session token (or hosted URL), or a function that fetches one from your server when clicked. */
  session: SessionSource;
  /** Button content; a function receives the checkout state (e.g. to show "Opening…"). */
  children?: ReactNode | ((state: CheckoutState) => ReactNode);
  /** Called before the session is fetched; return false to cancel. */
  onClick?: () => boolean | void;
}

/**
 * A `<button>` that opens the checkout popup. Disabled while a checkout is in progress.
 * Pass `onSuccess` to react when Pletopay sees the payment (then confirm server-side).
 */
export function PletopayCheckoutButton({
  session,
  children = 'Pay with bank transfer',
  onClick,
  onSuccess,
  onPending,
  onError,
  onClose,
  appearance,
  disabled,
  type = 'button',
  ...rest
}: PletopayCheckoutButtonProps) {
  const checkout = usePletopayCheckout();
  const handleClick = useCallback(() => {
    if (onClick?.() === false) return;
    void checkout.open(session, { onSuccess, onPending, onError, onClose, appearance });
  }, [checkout, session, onClick, onSuccess, onPending, onError, onClose, appearance]);
  return (
    <button
      type={type}
      disabled={disabled || checkout.busy}
      aria-busy={checkout.busy || undefined}
      data-pletopay-status={checkout.status}
      onClick={handleClick}
      {...rest}
    >
      {typeof children === 'function' ? children(checkout) : children}
    </button>
  );
}
