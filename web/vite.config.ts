import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/auth': 'http://localhost:3000',
      '/items': 'http://localhost:3000',
      '/teams': 'http://localhost:3000',
      '/invitations': 'http://localhost:3000',
      '/admin': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/ready': 'http://localhost:3000',
    },
  },
})
