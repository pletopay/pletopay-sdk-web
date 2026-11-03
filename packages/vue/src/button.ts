import { computed, defineComponent, h, type PropType } from 'vue';
import type {
  CheckoutOptions,
  CloseResult,
  PendingResult,
  PletopayError,
  SessionSource,
  SuccessResult,
} from '@pletopay/js';
import { usePletopayCheckout } from './checkout';

/**
 * A `<button>` that opens the checkout popup; disabled while a checkout is in progress.
 *
 * ```vue
 * <PletopayCheckoutButton :session="fetchSessionToken" @success="onPaid">Pay with bank transfer</PletopayCheckoutButton>
 * ```
 * The default slot receives the checkout state: `<template #default="{ state }">{{ state.busy ? 'Opening…' : 'Pay' }}</template>`.
 */
export const PletopayCheckoutButton = defineComponent({
  name: 'PletopayCheckoutButton',
  props: {
    /** The session token (or hosted URL), or a function that fetches one from your server when clicked. */
    session: { type: [String, Function] as PropType<SessionSource>, required: true },
    disabled: { type: Boolean, default: false },
    appearance: { type: Object as PropType<CheckoutOptions['appearance']>, default: undefined },
  },
  emits: {
    success: (_result: SuccessResult) => true,
    pending: (_result: PendingResult) => true,
    error: (_error: PletopayError) => true,
    close: (_result: CloseResult) => true,
  },
  setup(props, { emit, slots, attrs }) {
    const checkout = usePletopayCheckout();
    const busy = computed(() => checkout.state.value.busy);
    const onClick = (): void => {
      void checkout.open(props.session, {
        appearance: props.appearance,
        onSuccess: (r) => emit('success', r),
        onPending: (r) => emit('pending', r),
        onError: (e) => emit('error', e),
        onClose: (r) => emit('close', r),
      });
    };
    return () =>
      h(
        'button',
        {
          ...attrs,
          type: 'button',
          disabled: props.disabled || busy.value,
          'aria-busy': busy.value || undefined,
          'data-pletopay-status': checkout.state.value.status,
          onClick,
        },
        slots.default ? slots.default({ state: checkout.state.value }) : 'Pay with bank transfer',
      );
  },
});
