import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// ESM for bundlers, and an IIFE with the `NanoPlayer` global for a plain
// `<script>` tag.
export default defineConfig({
  build: {
    lib: {
      // The barrel, not `nanoplayer.ts`: with that entry the build shipped
      // little more than `create`, leaving out what the README documents.
      entry: fileURLToPath(new URL('src/index.ts', import.meta.url)),
      name: 'NanoPlayer',
      formats: ['es', 'iife'],
      // Must match `main`/`exports` in package.json.
      fileName: (format) => (format === 'iife' ? 'nanoplayer.min.js' : 'index.js'),
    },
    sourcemap: true,
    target: 'es2022',
    rollupOptions: { output: { exports: 'named' } },
  },
});
