import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/dashboard': 'http://localhost:3000',
      '/analytics': 'http://localhost:3000',
      '/contacts': 'http://localhost:3000',
      '/respond': 'http://localhost:3000',
      '/drafts': 'http://localhost:3000',
      '/audit': 'http://localhost:3000',
    }
  }
})
