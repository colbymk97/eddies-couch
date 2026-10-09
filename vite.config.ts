import { defineConfig } from 'vite';

export default defineConfig({
  base: '/eddies-couch/',
  build: {
    outDir: 'dist',
    // three.js alone is ~600 kB minified; one chunk is fine for a single-page game.
    chunkSizeWarningLimit: 1200,
  },
});
