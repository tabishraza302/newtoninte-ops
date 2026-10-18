import express, { type Express } from 'express'
import { requestId } from './http/middleware/requestId'
import { notFound } from './http/middleware/notFound'
import { errorHandler } from './http/middleware/errorHandler'
import { healthRouter } from './http/routes/health'

export function createApp(): Express {
  const app = express()
  app.use(requestId())
  app.use(express.json())
  app.use(healthRouter)
  app.use(notFound())
  app.use(errorHandler())
  return app
}
