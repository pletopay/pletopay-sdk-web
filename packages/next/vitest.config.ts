import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@pletopay/js': fileURLToPath(new URL('../js/src/index.ts', import.meta.url)),
      '@pletopay/react': fileURLToPath(new URL('../react/src/index.ts', import.meta.url)),
    },
  },
  test: { name: 'next', environment: 'node', include: ['test/**/*.spec.ts'] },
});
