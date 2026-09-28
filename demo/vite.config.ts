import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Apunta al código fuente del núcleo, no a su build: así los cambios se ven al
// instante y la demo sirve de banco de pruebas mientras se desarrolla.
export default defineConfig({
  // Rutas relativas: en GitHub Pages la web cuelga de /nanoplayer/, no de la
  // raíz del dominio.
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
      // La web entera: la portada y una carpeta por página, para que las
      // direcciones publicadas sean /video/, /live/ y /bench/.
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
