import { defineConfig } from 'vitest/config';

const source = (p: string) => new URL(p, import.meta.url).pathname;

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // Packages resolve to their source, not `dist`: on a clean checkout tests
    // run before any build, and resolving to `dist` broke CI that way.
    alias: {
      '@nanoplayer/core': source('packages/core/src/index.ts'),
      '@nanoplayer/ui': source('packages/ui/src/index.ts'),
      '@nanoplayer/plugin-captions': source('packages/plugin-captions/src/index.ts'),
      '@nanoplayer/plugin-chapters': source('packages/plugin-chapters/src/index.ts'),
      '@nanoplayer/engine-hls': source('packages/engine-hls/src/index.ts'),
    },
  },
});
