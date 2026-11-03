import { addComponent, addImports, addPlugin, addServerImports, createResolver, defineNuxtModule } from '@nuxt/kit';
import type { NuxtModule } from '@nuxt/schema';
import { defu } from 'defu';

export interface ModuleOptions {
  /** Your publishable key (`pk_test_…` / `pk_live_…`), exposed to the browser as `runtimeConfig.public.pletopay.publicKey`. */
  publicKey?: string;
  /** The checkout origin, default `https://checkout.pletopay.com`. */
  checkoutUrl?: string;
  /** Load pletopay.js when the app mounts (default) or at the first checkout. */
  loadOnMount?: boolean;
  /** Server only: your secret key for `usePletopayServer()`. Prefer the env var `NUXT_PLETOPAY_SECRET_KEY`. */
  secretKey?: string;
  /** Server only: the `whsec_…` for `definePletopayWebhookHandler()`. Prefer `NUXT_PLETOPAY_WEBHOOK_SECRET`. */
  webhookSecret?: string;
  /** Server only: API base URL override (local development). */
  apiUrl?: string;
}

const module: NuxtModule<ModuleOptions> = defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@pletopay/nuxt',
    configKey: 'pletopay',
    compatibility: { nuxt: '>=3.13.0' },
  },
  defaults: {
    checkoutUrl: 'https://checkout.pletopay.com',
    loadOnMount: true,
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url);

    // Browser values. Environment overrides: NUXT_PUBLIC_PLETOPAY_PUBLIC_KEY, NUXT_PUBLIC_PLETOPAY_CHECKOUT_URL.
    nuxt.options.runtimeConfig.public.pletopay = defu(nuxt.options.runtimeConfig.public.pletopay, {
      publicKey: options.publicKey ?? '',
      checkoutUrl: options.checkoutUrl,
      loadOnMount: options.loadOnMount,
    });
    // Server values. Environment overrides: NUXT_PLETOPAY_SECRET_KEY, NUXT_PLETOPAY_WEBHOOK_SECRET, NUXT_PLETOPAY_API_URL.
    nuxt.options.runtimeConfig.pletopay = defu(nuxt.options.runtimeConfig.pletopay, {
      secretKey: options.secretKey ?? '',
      webhookSecret: options.webhookSecret ?? '',
      apiUrl: options.apiUrl ?? '',
    });

    addPlugin(resolve('./runtime/plugin'));
    addImports([
      { name: 'usePletopay', from: '@pletopay/vue' },
      { name: 'usePletopayCheckout', from: '@pletopay/vue' },
    ]);
    addComponent({ name: 'PletopayCheckoutButton', export: 'PletopayCheckoutButton', filePath: '@pletopay/vue' });
    addServerImports([
      { name: 'usePletopayServer', from: resolve('./runtime/server/utils/pletopay') },
      { name: 'definePletopayWebhookHandler', from: resolve('./runtime/server/utils/pletopay') },
    ]);

    // @pletopay/node is server-only (node:crypto); keep it out of the client bundle.
    nuxt.options.build.transpile.push('@pletopay/vue');
    nuxt.options.vite ??= {};
    nuxt.options.vite.optimizeDeps ??= {};
    nuxt.options.vite.optimizeDeps.include = [
      ...(nuxt.options.vite.optimizeDeps.include ?? []),
      '@pletopay/vue',
      '@pletopay/js',
    ];
  },
});

export default module;

declare module 'nuxt/schema' {
  interface PublicRuntimeConfig {
    pletopay: { publicKey: string; checkoutUrl: string; loadOnMount: boolean };
  }
  interface RuntimeConfig {
    pletopay: { secretKey: string; webhookSecret: string; apiUrl: string };
  }
}
