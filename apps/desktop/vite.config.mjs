import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: __dirname,
  plugins: [
    tailwindcss(),
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', {}]]
      }
    })
  ],
  resolve: {
    alias: {
      '@renderer': path.join(__dirname, 'src/renderer'),
      '@shared': path.join(__dirname, 'src/shared')
    }
  },
  base: './',
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true
  },
  test: {
    include: ['src/**/*.test.ts', 'electron/**/*.test.js']
  },
  build: {
    outDir: path.join(__dirname, 'dist'),
    sourcemap: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          return 'vendor'
        }
      }
    }
  }
})
