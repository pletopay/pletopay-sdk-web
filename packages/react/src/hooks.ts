import { useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import {
  createCheckoutController,
  type CheckoutCallbacks,
  type CheckoutHandle,
  type CheckoutState,
  type RedirectOptions,
  type SessionSource,
} from '@pletopay/js';
import { PletopayContext, type PletopayContextValue } from './context';

/** The shared pletopay.js client and its load state. Must be used below a `PletopayProvider`. */
export function usePletopay(): PletopayContextValue {
  const context = useContext(PletopayContext);
  if (!context) throw new Error('usePletopay must be used inside <PletopayProvider>');
  return context;
}

export interface UsePletopayCheckout extends CheckoutState {
  /** Opens the popup for a session token (or a function that fetches one from your server). */
  open: (session: SessionSource, callbacks?: CheckoutCallbacks) => Promise<CheckoutHandle | null>;
  /** Closes the popup (the customer is asked to confirm while a transfer may be in flight). */
  close: () => void;
  /** Sends the customer to the hosted checkout page instead of opening the popup. */
  redirect: (options: RedirectOptions) => Promise<void>;
  /** Clears result and error after the popup closed. */
  reset: () => void;
}

/**
 * Checkout state for one button or flow: `open(session)` then render `status`, `result`, `error`.
 *
 * @example
 * const checkout = usePletopayCheckout();
 * <button disabled={checkout.busy} onClick={() => checkout.open(() => fetchSessionToken())}>Pay</button>
 */
export function usePletopayCheckout(): UsePletopayCheckout {
  const { getClient } = usePletopay();
  const controller = useMemo(() => createCheckoutController({ getClient }), [getClient]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const redirect = useCallback(
    async (options: RedirectOptions) => {
      const client = await getClient();
      if (!client) throw new Error('Pletopay checkout is only available in the browser');
      client.redirectToCheckout(options);
    },
    [getClient],
  );
  return useMemo(
    () => ({ ...state, open: controller.open, close: controller.close, redirect, reset: controller.reset }),
    [state, controller, redirect],
  );
}
