import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import { flowFilesApi } from "./server/api"

// https://vite.dev/config/
// 单进程架构：前端 + /api/* REST 接口都由 vite dev server 提供。
// 端口不在这里固定，交给 CLI 透传：npm run dev -- --port <N>
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react(), flowFilesApi(path.resolve(__dirname))],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
