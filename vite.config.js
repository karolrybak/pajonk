import { defineConfig } from 'vite';

export default defineConfig({
  base: '/pajonk/',
  server: {
    port: 3000,
    open: true
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