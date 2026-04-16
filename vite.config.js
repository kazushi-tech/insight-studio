import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const proxy = {
  '/api/ml': {
    target: 'http://localhost:8002',
    changeOrigin: true,
  },
  '/api/ads': {
    target: 'http://localhost:8002',
    changeOrigin: true,
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3002,
    proxy,
  },
  preview: {
    port: 3004,
    proxy,
  },
})
