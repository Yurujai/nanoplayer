import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Apunta al código fuente del núcleo, no a su build: así los cambios se ven al
// instante y la demo sirve de banco de pruebas mientras se desarrolla.
export default defineConfig({
  // Rutas relativas: en GitHub Pages la demo cuelga de un subdirectorio, no de
  // la raíz del dominio.
  base: './',
  resolve: {
    alias: {
      '@nanoplayer/core': fileURLToPath(new URL('../packages/core/src/index.ts', import.meta.url)),
      '@nanoplayer/ui': fileURLToPath(new URL('../packages/ui/src/index.ts', import.meta.url)),
      '@nanoplayer/engine-hls': fileURLToPath(
        new URL('../packages/engine-hls/src/index.ts', import.meta.url)),
      '@nanoplayer/plugin-captions': fileURLToPath(
        new URL('../packages/plugin-captions/src/index.ts', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        banco: fileURLToPath(new URL('banco.html', import.meta.url)),
      },
    },
  },
  server: { port: 5180 },
});
