import { vi } from 'vitest';
import type { CheckoutOptions, PletopayClient, PletopayOptions } from '../src/pletopay-types';

/** A fake pletopay.js client whose callbacks the test can fire. */
export function fakeClient(options: PletopayOptions) {
  let current: CheckoutOptions | null = null;
  let open = false;
  const client: PletopayClient & {
    fire: {
      success(): void;
      pending(): void;
      error(code?: string): void;
      close(reason?: 'user' | 'complete' | 'expired' | 'error'): void;
    };
    last: () => CheckoutOptions | null;
    options: PletopayOptions;
  } = {
    options,
    version: '1.0.0-test',
    checkout: vi.fn((opts: CheckoutOptions) => {
      if (open) return null;
      if (!opts.session) {
        opts.onError?.({ code: 'invalid_options', message: 'session is required', retryable: false });
        return null;
      }
      current = opts;
      open = true;
      return { close: () => client.fire.close('user') };
    }),
    redirectToCheckout: vi.fn(),
    close: vi.fn(() => client.fire.close('user')),
    isOpen: () => open,
    last: () => current,
    fire: {
      success: () => current?.onSuccess?.({ session: current.session, status: 'complete' }),
      pending: () => current?.onPending?.({ session: current.session, paymentStatus: 'processing' }),
      error: (code = 'network_error') =>
        current?.onError?.({ code: code as never, message: `fake ${code}`, retryable: true }),
      close: (reason = 'user') => {
        if (!open) return;
        open = false;
        const opts = current;
        current = null;
        opts?.onClose?.({ reason });
      },
    },
  };
  return client;
}

export type FakeClient = ReturnType<typeof fakeClient>;

/** Installs `window.Pletopay` returning fake clients and records them. */
export function installFakeFactory() {
  const clients: FakeClient[] = [];
  const factory = vi.fn((options: PletopayOptions) => {
    const c = fakeClient(options);
    clients.push(c);
    return c;
  });
  window.Pletopay = factory;
  return { factory, clients };
}
