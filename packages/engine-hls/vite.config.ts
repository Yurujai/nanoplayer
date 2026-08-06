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
    // hls.js queda fuera del bundle: es dependencia de pares y se carga en
    // diferido, así que quien no reproduzca HLS no la descarga.
    rollupOptions: { external: ['hls.js'] },
    sourcemap: true,
    target: 'es2022',
  },
});
