import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Dos formatos con propósitos distintos:
//   - ESM  para quien tenga build propio, con tree-shaking.
//   - IIFE con la global `NanoPlayer`, para el caso `<script>` del objetivo O5:
//     cero configuración, cero herramientas.
export default defineConfig({
  build: {
    lib: {
      // El barril, no `nanoplayer.ts`. Este era el entry y publicaba ocho
      // exports: `create` y poco más. Todo lo que el README documenta
      // —`validateManifest`, `EventBus`, `Synchronizer`— quedaba fuera del
      // paquete construido aunque estuviera en el código.
      entry: fileURLToPath(new URL('src/index.ts', import.meta.url)),
      name: 'NanoPlayer',
      formats: ['es', 'iife'],
      // `index.js` para que case con `main`/`exports` del package.json, que
      // apuntaban a un fichero que no se llegaba a emitir.
      fileName: (format) => (format === 'iife' ? 'nanoplayer.min.js' : 'index.js'),
    },
    sourcemap: true,
    target: 'es2022',
    rollupOptions: { output: { exports: 'named' } },
  },
});
