import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'nuxt',
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    exclude: ['test/fixtures/**'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
