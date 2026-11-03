import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2020',
    platform: 'browser',
    external: ['react', 'react/jsx-runtime', '@pletopay/react', '@pletopay/js'],
    banner: { js: "'use client';" },
  },
  {
    entry: { server: 'src/server/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    target: 'node20',
    platform: 'node',
    external: ['@pletopay/node'],
  },
]);
