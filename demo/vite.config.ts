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
      '@nanoplayer/plugin-pip': fileURLToPath(
        new URL('../packages/plugin-pip/src/index.ts', import.meta.url)),
      '@nanoplayer/plugin-audio-tracks': fileURLToPath(
        new URL('../packages/plugin-audio-tracks/src/index.ts', import.meta.url)),
      '@nanoplayer/plugin-media-session': fileURLToPath(
        new URL('../packages/plugin-media-session/src/index.ts', import.meta.url)),
      '@nanoplayer/plugin-quality': fileURLToPath(
        new URL('../packages/plugin-quality/src/index.ts', import.meta.url)),
      '@nanoplayer/plugin-resume': fileURLToPath(
        new URL('../packages/plugin-resume/src/index.ts', import.meta.url)),
      '@nanoplayer/plugin-transcript': fileURLToPath(
        new URL('../packages/plugin-transcript/src/index.ts', import.meta.url)),
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
