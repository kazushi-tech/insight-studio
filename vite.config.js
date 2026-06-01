import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// ローカル開発の proxy: 同一オリジン /api/* → ローカル backend。
// 既定は dev.ps1 が起動するローカル uvicorn ポート。env で転送先を上書きできる
// （ADS_PROXY_TARGET / ML_PROXY_TARGET）。これらはサーバー専用でバンドルされないため
// VITE_ 接頭辞は付けない（秘密値ではないが、ブラウザに露出する必要もない）。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const ADS_TARGET = env.ADS_PROXY_TARGET || 'http://127.0.0.1:8001'
  const ML_TARGET = env.ML_PROXY_TARGET || 'http://127.0.0.1:8002'

  const proxy = {
    '/api/ml': {
      target: ML_TARGET,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api\/ml/, '/api'),
    },
    '/api/ads': {
      target: ADS_TARGET,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api\/ads/, '/api'),
    },
    '/api/insights': {
      target: ADS_TARGET,
      changeOrigin: true,
    },
  }

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 3002,
      proxy,
    },
    preview: {
      port: 3004,
      proxy,
    },
  }
})
