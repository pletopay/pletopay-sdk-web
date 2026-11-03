# Contributing

Thanks for helping improve the Pletopay client-side SDKs.

## Setup

```bash
pnpm install
pnpm verify
```

Node.js 22 and pnpm 10 are used for development; the packages support Node.js 20+ for tooling and evergreen browsers at runtime.

## Layout

- `packages/js`: the loader and the framework-agnostic checkout controller. `src/pletopay-types.ts` is vendored from the pletopay.js source (`pnpm sync:types`; CI fails when stale).
- `packages/react`, `packages/vue`: thin bindings over `@pletopay/js`. Tests mock `window.Pletopay` with `packages/js/test/fake-pletopay.ts` so the popup never loads.
- `packages/next`, `packages/nuxt`: framework packages that reuse React/Vue and add server-side helpers over `@pletopay/node`.
- `packages/react-native`: WebView checkout and a headless client for the token-authenticated checkout API.

Each package has its own `tsup`, `vitest` (or Jest) and `check:package` (publint + arethetypeswrong). The root `pnpm verify` runs everything.

## Changes and releases

1. Make the change, add tests, update the package README.
2. `pnpm changeset` and describe the change for each affected package.
3. Open a pull request. CI runs `pnpm verify`.
4. On `main`, the release workflow opens a "Version packages" pull request; merging it bumps versions, writes changelogs and publishes each changed package to npm with provenance.

## Style

Prettier and ESLint are enforced. The brand is spelled "Pletopay"; only the protocol headers (`X-PletoPay-Signature`, `PletoPay-Version`) keep the capital P, and `pnpm check:brand` enforces this.
