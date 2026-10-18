import { handlers } from './outbox/handlers'
import { startWorker } from './outbox/worker'
import { closeDb } from './db/client'

export const worker = startWorker({ handlers })

let isShuttingDown = false

export async function shutdown(): Promise<void> {
  if (isShuttingDown) return
  isShuttingDown = true
  try {
    await worker.stop()
    await closeDb()
  } catch (err) {
    console.error('Error during worker shutdown:', err)
  }
}

process.on('SIGINT', () => {
  void shutdown().then(() => process.exit(0))
})
process.on('SIGTERM', () => {
  void shutdown().then(() => process.exit(0))
})
