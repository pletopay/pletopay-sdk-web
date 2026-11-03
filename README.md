# Pletopay client-side SDKs

The browser and app-side half of the Pletopay integration. Your server creates checkout sessions with a secret key (`@pletopay/node`, `pletopay` for Python, `@pletopay/nestjs`); these packages open and track them with your **publishable** key, which authorises nothing on its own.

| Package                                           | For                                                                                    | Docs                                      |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------- |
| [`@pletopay/js`](packages/js)                     | Any browser code: loads pletopay.js and returns the typed popup client                 | [README](packages/js/README.md)           |
| [`@pletopay/react`](packages/react)               | React 18/19: provider, `usePletopayCheckout`, `<PletopayCheckoutButton>`               | [README](packages/react/README.md)        |
| [`@pletopay/vue`](packages/vue)                   | Vue 3: plugin, `usePletopayCheckout`, `<PletopayCheckoutButton>`                       | [README](packages/vue/README.md)          |
| [`@pletopay/next`](packages/next)                 | Next.js: the React package plus server helpers (webhook route handlers, server client) | [README](packages/next/README.md)         |
| [`@pletopay/nuxt`](packages/nuxt)                 | Nuxt 3/4: module with runtime config, auto-imports and Nitro helpers                   | [README](packages/nuxt/README.md)         |
| [`@pletopay/react-native`](packages/react-native) | React Native / Expo: hosted checkout in a WebView plus a headless session client       | [README](packages/react-native/README.md) |

Flutter lives in its own repository, `pletopay-sdk-flutter` (pub.dev `pletopay_flutter`).

Every package is versioned and published independently with [Changesets](https://github.com/changesets/changesets): one npm tag per package.

## Development

```bash
pnpm install
pnpm verify          # lint, format, typecheck, vendored-types check, brand check, tests, build and package checks
pnpm sync:types      # re-vendor the pletopay.js types from ../pletopay-checkout
pnpm changeset       # describe a change; the release workflow bumps versions and publishes
```

## License

[MIT](LICENSE)
