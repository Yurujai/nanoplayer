import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Points at the packages' source, not their build, so changes show up at once.
export default defineConfig({
  // Relative paths: on GitHub Pages the site lives under /nanoplayer/.
  base: './',
  resolve: {
    alias: {
      '@nanoplayer/core': fileURLToPath(new URL('../packages/core/src/index.ts', import.meta.url)),
      '@nanoplayer/ui': fileURLToPath(new URL('../packages/ui/src/index.ts', import.meta.url)),
      '@nanoplayer/engine-hls': fileURLToPath(
        new URL('../packages/engine-hls/src/index.ts', import.meta.url)),
      '@nanoplayer/plugin-captions': fileURLToPath(
        new URL('../packages/plugin-captions/src/index.ts', import.meta.url)),
      '@nanoplayer/plugin-chapters': fileURLToPath(
        new URL('../packages/plugin-chapters/src/index.ts', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        video: fileURLToPath(new URL('video/index.html', import.meta.url)),
        live: fileURLToPath(new URL('live/index.html', import.meta.url)),
        bench: fileURLToPath(new URL('bench/index.html', import.meta.url)),
      },
    },
  },
  server: { port: 5180 },
});
