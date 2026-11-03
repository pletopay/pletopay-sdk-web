import PletopayModule from '../../../src/module';

export default defineNuxtConfig({
  modules: [PletopayModule],
  pletopay: {
    publicKey: 'pk_test_fixture_key',
    checkoutUrl: 'https://checkout.pletopay.com',
    secretKey: 'sk_test_fixture_fixture',
    webhookSecret: 'whsec_sdk_fixture_secret_0123456789',
    apiUrl: 'http://127.0.0.1:1',
  },
  ssr: true,
});
