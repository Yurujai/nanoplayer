import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@nanoplayer/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL('src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    // Core stays external: bundling it gives each package its own plugin
    // registry singleton, and plugins silently never activate (e2e dist.mjs).
    rollupOptions: { external: ['@nanoplayer/core'] },
    sourcemap: true,
    target: 'es2022',
  },
});
