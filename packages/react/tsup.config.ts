import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  platform: 'browser',
  splitting: false,
  external: ['react', 'react/jsx-runtime', '@pletopay/js'],
  // Everything here runs in the browser; Next.js App Router needs the directive on the bundle.
  banner: { js: "'use client';" },
});
