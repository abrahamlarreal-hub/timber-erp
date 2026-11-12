import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 2000 },
  server: {
    proxy: Object.fromEntries(['/rest/v1', '/auth/v1', '/realtime/v1'].map((p) => [p, { target: 'http://127.0.0.1:54321', changeOrigin: true, ws: true }])),
  },
})
