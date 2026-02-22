import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'
import * as apiPlugin from './src/viteApiPlugin.js'
import ui from '@nuxt/ui/vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  server: {
    port: 3000,
    open: true,
  },
  assetsInclude: ['**/*.wgsl'],
  plugins: [
    apiPlugin,
    vue(),
    vueJsx(),
    vueDevTools(),
    ui(),
    tailwindcss(),

  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})
