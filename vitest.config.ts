import { defineConfig } from 'vitest/config';

const fuente = (p: string) => new URL(p, import.meta.url).pathname;

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    /*
     * Los paquetes se resuelven a su CÓDIGO FUENTE, no a su `dist`.
     *
     * Sin esto, cualquier test que importe un hermano por su nombre —como el
     * del bundle, que no puede hacer otra cosa— depende de que exista un build
     * previo. En local eso pasa desapercibido porque el `dist` suele estar de
     * antes; en un checkout limpio, donde `pnpm test` corre antes que
     * `pnpm build`, falla. Así fue como rompió el CI.
     *
     * Faltaban `ui` y `plugin-captions`: solo estaba el del núcleo.
     */
    alias: {
      '@nanoplayer/core': fuente('packages/core/src/index.ts'),
      '@nanoplayer/ui': fuente('packages/ui/src/index.ts'),
      '@nanoplayer/plugin-captions': fuente('packages/plugin-captions/src/index.ts'),
      '@nanoplayer/engine-hls': fuente('packages/engine-hls/src/index.ts'),
    },
  },
});
