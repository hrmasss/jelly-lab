import { defineConfig } from 'vite';

// Relative base so the build works from any path, including GitHub Pages project sites.
export default defineConfig({
  base: './',
  // three.js alone is ~580 kB; one chunk is fine for a toy.
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
