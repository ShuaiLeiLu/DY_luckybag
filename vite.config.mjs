import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  server: {
    port: 5173
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (
            id.includes('/naive-ui/') ||
            id.includes('/vueuc/') ||
            id.includes('/vooks/') ||
            id.includes('/vdirs/') ||
            id.includes('/seemly/') ||
            id.includes('/evtd/') ||
            id.includes('/treemate/')
          ) {
            return 'naive'
          }
          return 'vendor'
        }
      }
    }
  }
})
