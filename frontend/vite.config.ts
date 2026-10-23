import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Forward /api requests to the FastAPI backend, so there are no CORS issues in dev
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
