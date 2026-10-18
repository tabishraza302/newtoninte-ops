import { createApp } from './app'
import { config } from './config'
import { closeDb } from './db/client'

const app = createApp()

export const server = app.listen(config.port, () => {
  console.log(`api listening on port ${config.port}`)
})

let isShuttingDown = false

export async function shutdown(signal: string = 'SIGTERM'): Promise<void> {
  if (isShuttingDown) return
  isShuttingDown = true

  return new Promise<void>((resolve) => {
    server.close(async (err) => {
      if (err) {
        console.error('Error closing HTTP server:', err)
      }
      try {
        await closeDb()
      } catch (dbErr) {
        console.error('Error closing database pool:', dbErr)
      } finally {
        resolve()
      }
    })
  })
}

process.on('SIGINT', () => {
  void shutdown('SIGINT').then(() => process.exit(0))
})
process.on('SIGTERM', () => {
  void shutdown('SIGTERM').then(() => process.exit(0))
})
