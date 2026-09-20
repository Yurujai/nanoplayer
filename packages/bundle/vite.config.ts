import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Al revés que los demás paquetes: aquí **no** se externaliza nada. Que el
// núcleo, la interfaz y los subtítulos queden dentro es justamente el motivo de
// que este paquete exista — una etiqueta `<script>` no resuelve imports.
export default defineConfig({
  resolve: {
    alias: {
      '@nanoplayer/core': src('../core/src/index.ts'),
      '@nanoplayer/ui': src('../ui/src/index.ts'),
      '@nanoplayer/plugin-captions': src('../plugin-captions/src/index.ts'),
    },
  },
  build: {
    lib: {
      entry: src('src/index.ts'),
      name: 'NanoPlayer',
      /*
       * Tres formatos, y el UMD **no sustituye al IIFE** aunque lo parezca.
       *
       * UMD mira primero si hay `define.amd`. En una página que ya carga
       * RequireJS —Moodle es el caso— un `<script src>` de UMD se registra
       * como módulo anónimo y **no crea la global**: la etiqueta dejaría de
       * funcionar justo donde más falta hace. Por eso conviven:
       *
       *   nanoplayer.min.js   IIFE, siempre deja la global. Para `<script>`.
       *   nanoplayer.umd.js   UMD, para cargadores AMD y para CommonJS.
       */
      formats: ['es', 'iife', 'umd'],
      fileName: (format) => {
        if (format === 'iife') return 'nanoplayer.min.js';
        if (format === 'umd') return 'nanoplayer.umd.js';
        return 'index.js';
      },
    },
    sourcemap: true,
    target: 'es2022',
    rollupOptions: { output: { exports: 'named' } },
  },
});
