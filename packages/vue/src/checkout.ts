import { onScopeDispose, shallowRef, type ShallowRef } from 'vue';
import {
  createCheckoutController,
  type CheckoutCallbacks,
  type CheckoutHandle,
  type CheckoutState,
  type RedirectOptions,
  type SessionSource,
} from '@pletopay/js';
import { usePletopay } from './plugin';

export interface UsePletopayCheckout {
  /** The whole checkout state, reactive. */
  state: ShallowRef<CheckoutState>;
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
 * Checkout state for one button or flow.
 *
 * @example
 * const { state, open } = usePletopayCheckout();
 * <button :disabled="state.busy" @click="open(() => fetchSessionToken())">Pay</button>
 */
export function usePletopayCheckout(): UsePletopayCheckout {
  const { getClient } = usePletopay();
  const controller = createCheckoutController({ getClient });
  const state = shallowRef<CheckoutState>(controller.getState());
  const unsubscribe = controller.subscribe((next) => {
    state.value = next;
  });
  onScopeDispose(unsubscribe, true);
  return {
    state,
    open: controller.open,
    close: controller.close,
    reset: controller.reset,
    redirect: async (options) => {
      const client = await getClient();
      if (!client) throw new Error('Pletopay checkout is only available in the browser');
      client.redirectToCheckout(options);
    },
  };
}
