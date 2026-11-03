import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'js', environment: 'happy-dom', include: ['test/**/*.spec.ts'] },
});
