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
    /*
     * El núcleo va FUERA del bundle.
     *
     * Sin esto, el alias a `../core/src/index.ts` impide que Vite lo
     * externalice y cada paquete se lleva dentro su propia copia —incluidos
     * `new PluginRegistry()` y el registro compartido de la página—. El
     * resultado es que un plugin se registra en su propio singleton y el
     * reproductor mira otro: los subtítulos no se activan nunca, sin un solo
     * error por ninguna parte.
     */
    rollupOptions: { external: ['@nanoplayer/core'] },
    sourcemap: true,
    target: 'es2022',
  },
});
