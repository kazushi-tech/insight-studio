import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const proxy = {
  '/api/ml': {
    target: 'https://market-lens-ai.onrender.com',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/ml/, '/api'),
  },
  '/api/ads': {
    target: 'https://ads-insights-9q5s.onrender.com',
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
