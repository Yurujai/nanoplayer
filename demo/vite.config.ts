import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Apunta al código fuente del núcleo, no a su build: así los cambios se ven al
// instante y la demo sirve de banco de pruebas mientras se desarrolla.
export default defineConfig({
  resolve: {
    alias: {
      '@nanoplayer/core': fileURLToPath(new URL('../packages/core/src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5180 },
});
