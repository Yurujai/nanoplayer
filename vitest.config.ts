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
      '@nanoplayer/plugin-pip': source('packages/plugin-pip/src/index.ts'),
      '@nanoplayer/plugin-audio-tracks': source('packages/plugin-audio-tracks/src/index.ts'),
      '@nanoplayer/plugin-media-session': source('packages/plugin-media-session/src/index.ts'),
      '@nanoplayer/plugin-quality': source('packages/plugin-quality/src/index.ts'),
      '@nanoplayer/plugin-resume': source('packages/plugin-resume/src/index.ts'),
      '@nanoplayer/plugin-transcript': source('packages/plugin-transcript/src/index.ts'),
      '@nanoplayer/plugin-xapi': source('packages/plugin-xapi/src/index.ts'),
      '@nanoplayer/plugin-thumbnails': source('packages/plugin-thumbnails/src/index.ts'),
      '@nanoplayer/plugin-cast': source('packages/plugin-cast/src/index.ts'),
      '@nanoplayer/playlist': source('packages/playlist/src/index.ts'),
      '@nanoplayer/engine-hls': source('packages/engine-hls/src/index.ts'),
    },
  },
});
