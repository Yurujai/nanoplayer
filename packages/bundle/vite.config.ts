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
      formats: ['es', 'iife'],
      fileName: (format) => (format === 'iife' ? 'nanoplayer.min.js' : 'index.js'),
    },
    sourcemap: true,
    target: 'es2022',
    rollupOptions: { output: { exports: 'named' } },
  },
});
