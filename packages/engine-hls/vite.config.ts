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
    // hls.js: a lazy peer dependency. The core: without externalising it, the
    // source alias copies it in and the engine registers in a different registry.
    rollupOptions: { external: ['hls.js', '@nanoplayer/core'] },
    sourcemap: true,
    target: 'es2022',
  },
});
