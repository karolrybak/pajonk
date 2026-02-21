import { defineConfig } from 'vite';
import { apiPlugin } from './src/viteApiPlugin.js';

export default defineConfig({
  plugins: [apiPlugin],
  server: {
    port: 3000,
    open: true,
  },
  assetsInclude: ['**/*.wgsl'],
  build: {
    target: 'esnext'
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext'
    },
    include: ['three']
  }
});