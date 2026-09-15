import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base 用相对路径，方便 Capacitor 的 file:// 与 Android WebView 加载静态资源
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5174,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
