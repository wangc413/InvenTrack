import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base 用相对路径，这样部署到 GitHub Pages 的任意仓库子路径都能直接访问
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2019',
    chunkSizeWarningLimit: 1200,
  },
})
