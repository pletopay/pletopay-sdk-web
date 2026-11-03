import { inject, shallowRef, type App, type InjectionKey, type ShallowRef } from 'vue';
import { createPletopay, type LoadPletopayOptions, type PletopayClient } from '@pletopay/js';

export type PletopayLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PletopayPluginOptions extends LoadPletopayOptions {
  /** Your publishable key (`pk_test_…` / `pk_live_…`). Never a secret key. */
  publicKey: string;
  /** Load pletopay.js when the app mounts in the browser (default) or only when a checkout opens. */
  loadOnMount?: boolean;
}

export interface PletopayInstance {
  /** The pletopay.js client once loaded; `null` before that and on the server. */
  client: ShallowRef<PletopayClient | null>;
  status: ShallowRef<PletopayLoadStatus>;
  error: ShallowRef<Error | null>;
  /** Resolves to the client, loading pletopay.js if needed. */
  getClient: () => Promise<PletopayClient | null>;
  /** Tries loading again after an error. */
  reload: () => void;
  publicKey: string;
  checkoutUrl: string | undefined;
}

export const PLETOPAY_KEY: InjectionKey<PletopayInstance> = Symbol('pletopay');

/** Builds the shared instance (what `createPletopayPlugin` installs; use directly in tests or outside a Vue app). */
export function createPletopayInstance(options: PletopayPluginOptions): PletopayInstance {
  const client = shallowRef<PletopayClient | null>(null);
  const status = shallowRef<PletopayLoadStatus>('idle');
  const error = shallowRef<Error | null>(null);
  let promise: Promise<PletopayClient | null> | null = null;

  const getClient = (): Promise<PletopayClient | null> => {
    if (!options.publicKey)
      return Promise.reject(new Error('createPletopayPlugin needs a publicKey (pk_test_… / pk_live_…)'));
    if (!promise) {
      status.value = 'loading';
      error.value = null;
      promise = createPletopay(options.publicKey, {
        checkoutUrl: options.checkoutUrl,
        timeoutMs: options.timeoutMs,
        nonce: options.nonce,
      }).then(
        (created) => {
          client.value = created;
          status.value = created ? 'ready' : 'idle';
          return created;
        },
        (loadError: unknown) => {
          promise = null;
          const err = loadError instanceof Error ? loadError : new Error(String(loadError));
          status.value = 'error';
          error.value = err;
          throw err;
        },
      );
    }
    return promise;
  };

  return {
    client,
    status,
    error,
    getClient,
    reload: () => {
      promise = null;
      void getClient().catch(() => undefined);
    },
    publicKey: options.publicKey,
    checkoutUrl: options.checkoutUrl,
  };
}

/**
 * The Vue plugin: `app.use(createPletopayPlugin({ publicKey: 'pk_test_…' }))`.
 * Safe with server rendering: pletopay.js loads in the browser only.
 */
export function createPletopayPlugin(options: PletopayPluginOptions): { install: (app: App) => void } {
  return {
    install(app) {
      const instance = createPletopayInstance(options);
      app.provide(PLETOPAY_KEY, instance);
      app.config.globalProperties.$pletopay = instance;
      if (options.loadOnMount !== false && typeof window !== 'undefined')
        void instance.getClient().catch(() => undefined);
    },
  };
}

/** The shared pletopay.js client and its load state. Must be used in an app that installed the plugin. */
export function usePletopay(): PletopayInstance {
  const instance = inject(PLETOPAY_KEY, null);
  if (!instance) throw new Error('usePletopay: install the plugin first: app.use(createPletopayPlugin({ publicKey }))');
  return instance;
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $pletopay: PletopayInstance;
  }
}
