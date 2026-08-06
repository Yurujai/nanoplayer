import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    alias: { '@nanoplayer/core': new URL('packages/core/src/index.ts', import.meta.url).pathname },
  },
});
