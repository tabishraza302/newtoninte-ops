import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'

import type { IncomingMessage } from 'node:http'

const apiProxy = {
  target: 'http://localhost:3000',
  xfwd: true,
  configure(proxy) {
    proxy.on('proxyReq', (proxyReq, req) => {
      if (req.socket.remoteAddress) proxyReq.setHeader('X-Forwarded-For', req.socket.remoteAddress)
      else proxyReq.removeHeader('X-Forwarded-For')
    })
  },
  bypass: (req: IncomingMessage) => {
    const method = req.method ?? 'GET'
    const accept = req.headers.accept ?? ''
    if ((method === 'GET' || method === 'HEAD') && accept.includes('text/html')) {
      return '/index.html'
    }
    return undefined
  },
} satisfies ProxyOptions

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/auth': apiProxy,
      '/items': apiProxy,
      '/teams': apiProxy,
      '/invitations': apiProxy,
      '/admin': apiProxy,
      '/notifications': apiProxy,
      '/health': 'http://localhost:3000',
      '/ready': 'http://localhost:3000',
    },
  },
})
