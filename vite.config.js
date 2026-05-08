import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const proxy = {
  '/api/ml': {
    target: 'http://127.0.0.1:8002',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/ml/, '/api'),
  },
  '/api/ads': {
    target: 'http://127.0.0.1:8001',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/ads/, '/api'),
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
