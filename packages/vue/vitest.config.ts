import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@pletopay/js': fileURLToPath(new URL('../js/src/index.ts', import.meta.url)) } },
  test: { name: 'vue', environment: 'happy-dom', include: ['test/**/*.spec.ts'] },
});
