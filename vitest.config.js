import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfigInput from './vite.config.js'

// vite.config.js は関数形式（defineConfig(({ mode }) => {...})）でも
// オブジェクト形式でもエクスポートされうる。mergeConfig はコールバック形式の
// config を受け付けないため、関数なら test 用に解決してから渡す。
const viteConfig =
  typeof viteConfigInput === 'function'
    ? viteConfigInput({ mode: 'test', command: 'serve' })
    : viteConfigInput

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    css: false,
    mockReset: true,
  },
}))
