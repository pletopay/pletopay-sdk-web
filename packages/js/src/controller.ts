import type {
  CheckoutHandle,
  CheckoutOptions,
  CloseResult,
  PendingResult,
  PletopayClient,
  PletopayError,
  SuccessResult,
} from './pletopay-types';

/** Where the checkout is, from the integration's point of view. */
export type CheckoutStatus =
  /** Nothing open. */
  | 'idle'
  /** Fetching the session and loading the popup. */
  | 'opening'
  /** The popup is showing the account details. */
  | 'open'
  /** A transfer arrived and is being confirmed; the popup stays open. */
  | 'pending'
  /** Pletopay saw the payment (`onSuccess`). Confirm server-side before fulfilling. */
  | 'complete'
  /** The popup was closed without completing. */
  | 'closed'
  /** Loading or opening failed, or the popup reported an error. */
  | 'error';

export interface CheckoutState {
  status: CheckoutStatus;
  /** The popup is on screen. */
  isOpen: boolean;
  /** A checkout is in progress: disable your button. */
  busy: boolean;
  /** Set once `onSuccess` fired. */
  result: SuccessResult | null;
  /** The latest `onPending`, if any. */
  pending: PendingResult | null;
  /** How the popup last closed. */
  closed: CloseResult | null;
  error: PletopayError | Error | null;
}

/** The session to open: its token (or hosted URL), or a function that fetches it from your server. */
export type SessionSource = string | (() => string | Promise<string>);

export type CheckoutCallbacks = Pick<CheckoutOptions, 'onSuccess' | 'onPending' | 'onError' | 'onClose'> & {
  appearance?: CheckoutOptions['appearance'];
};

export interface CheckoutController {
  getState(): CheckoutState;
  subscribe(listener: (state: CheckoutState) => void): () => void;
  /** Resolves `session`, then opens the popup. Resolves to the handle, or `null` when it could not open. */
  open(session: SessionSource, callbacks?: CheckoutCallbacks): Promise<CheckoutHandle | null>;
  close(): void;
  reset(): void;
}

const INITIAL: CheckoutState = {
  status: 'idle',
  isOpen: false,
  busy: false,
  result: null,
  pending: null,
  closed: null,
  error: null,
};

/**
 * Framework-agnostic state around `client.checkout()`: one place that turns the popup callbacks into
 * a state object the React hook and the Vue composable both render.
 */
export function createCheckoutController(options: {
  getClient: () => Promise<PletopayClient | null>;
}): CheckoutController {
  let state: CheckoutState = INITIAL;
  let handle: CheckoutHandle | null = null;
  const listeners = new Set<(state: CheckoutState) => void>();
  const set = (patch: Partial<CheckoutState>): void => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async open(session, callbacks = {}) {
      if (state.busy) return null;
      set({ ...INITIAL, status: 'opening', busy: true });
      let client: PletopayClient | null;
      let token: string;
      try {
        [client, token] = await Promise.all([options.getClient(), typeof session === 'function' ? session() : session]);
      } catch (error) {
        set({ status: 'error', busy: false, error: error instanceof Error ? error : new Error(String(error)) });
        return null;
      }
      if (!client) {
        set({ status: 'error', busy: false, error: new Error('Pletopay checkout is only available in the browser') });
        return null;
      }
      handle = client.checkout({
        session: token,
        appearance: callbacks.appearance,
        onSuccess: (result) => {
          set({ status: 'complete', result });
          callbacks.onSuccess?.(result);
        },
        onPending: (pending) => {
          set({ status: 'pending', pending });
          callbacks.onPending?.(pending);
        },
        onError: (error) => {
          set({ status: 'error', error });
          callbacks.onError?.(error);
        },
        onClose: (closed) => {
          handle = null;
          set({
            status: state.status === 'complete' || state.status === 'error' ? state.status : 'closed',
            isOpen: false,
            busy: false,
            closed,
          });
          callbacks.onClose?.(closed);
        },
      });
      if (!handle) {
        // Already open elsewhere, or invalid options (then onError already ran synchronously).
        if (state.status !== 'error')
          set({ status: 'error', error: new Error('Checkout could not open: a popup is already open') });
        set({ busy: false });
        return null;
      }
      set({ status: state.status === 'opening' ? 'open' : state.status, isOpen: true });
      return handle;
    },
    close() {
      handle?.close();
    },
    reset() {
      if (!state.isOpen) set(INITIAL);
    },
  };
}
