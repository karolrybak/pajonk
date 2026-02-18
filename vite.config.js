import { defineConfig } from 'vite';

export default defineConfig({
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
  },
  resolve: {
    alias: {
      'three/webgpu': 'three/src/renderers/webgpu/WebGPURenderer.js'
    }
  }
});