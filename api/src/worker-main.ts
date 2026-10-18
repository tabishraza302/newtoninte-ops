import { handlers } from './outbox/handlers'
import { startWorker } from './outbox/worker'

const worker = startWorker({ handlers })

async function shutdown(): Promise<void> {
  await worker.stop()
  process.exit(0)
}

process.on('SIGINT', () => {
  void shutdown()
})
process.on('SIGTERM', () => {
  void shutdown()
})
