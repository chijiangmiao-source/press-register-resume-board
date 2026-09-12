import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 纯前端工程：无业务后端、不访问任何在线服务。
export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173
  },
  preview: {
    host: '0.0.0.0',
    port: 4173
  }
})
