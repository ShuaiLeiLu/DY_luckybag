import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', {}]]
      }
    })
  ],
  base: './',
  server: {
    port: 5173
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/react/')) return 'react'
          if (id.includes('/react-dom/')) return 'react-dom'
          return 'vendor'
        }
      }
    }
  }
})
