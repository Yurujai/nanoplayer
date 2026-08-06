import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Dos formatos con propósitos distintos:
//   - ESM  para quien tenga build propio, con tree-shaking.
//   - IIFE con la global `NanoPlayer`, para el caso `<script>` del objetivo O5:
//     cero configuración, cero herramientas.
export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('src/nanoplayer.ts', import.meta.url)),
      name: 'NanoPlayer',
      formats: ['es', 'iife'],
      fileName: (format) => (format === 'iife' ? 'nanoplayer.min.js' : 'nanoplayer.js'),
    },
    sourcemap: true,
    target: 'es2022',
    rollupOptions: { output: { exports: 'named' } },
  },
});
