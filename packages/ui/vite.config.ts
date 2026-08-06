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
      name: 'NanoPlayerUI',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    sourcemap: true,
    target: 'es2022',
  },
});
