import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// En desarrollo la API corre en :3000 y Vite le reenvía todo lo que empieza con /api.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:3000', rewrite: (p) => p.replace(/^\/api/, '') } } },
})
