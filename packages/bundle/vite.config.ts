import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Unlike the other packages nothing is externalised: a `<script>` tag cannot resolve imports.
export default defineConfig({
  resolve: {
    alias: {
      '@nanoplayer/core': src('../core/src/index.ts'),
      '@nanoplayer/ui': src('../ui/src/index.ts'),
      '@nanoplayer/plugin-captions': src('../plugin-captions/src/index.ts'),
      '@nanoplayer/plugin-chapters': src('../plugin-chapters/src/index.ts'),
      '@nanoplayer/plugin-pip': src('../plugin-pip/src/index.ts'),
    },
  },
  build: {
    lib: {
      entry: src('src/index.ts'),
      name: 'NanoPlayer',
      // UMD does not replace the IIFE: with RequireJS on the page (Moodle) a UMD
      // `<script src>` registers as an anonymous module and creates no global.
      // Checked by e2e/integration.mjs.
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
