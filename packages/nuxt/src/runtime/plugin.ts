import { createPletopayPlugin } from '@pletopay/vue';
import { defineNuxtPlugin, useRuntimeConfig } from '#imports';

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig().public.pletopay;
  nuxtApp.vueApp.use(
    createPletopayPlugin({
      publicKey: config.publicKey,
      checkoutUrl: config.checkoutUrl || undefined,
      loadOnMount: config.loadOnMount,
    }),
  );
});
