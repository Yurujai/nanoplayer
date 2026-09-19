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
    //
    // El núcleo, por lo mismo que en los demás paquetes: sin externalizarlo, el
    // alias al código fuente hace que se copie dentro y el motor acabaría
    // registrándose en un registro distinto del que usa el reproductor.
    rollupOptions: { external: ['hls.js', '@nanoplayer/core'] },
    sourcemap: true,
    target: 'es2022',
  },
});
