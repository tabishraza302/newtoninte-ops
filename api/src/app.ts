import express, { type Express } from 'express'
import { config } from './config'
import { requestId } from './http/middleware/requestId'
import { requestLogger } from './http/middleware/logging'
import { notFound } from './http/middleware/notFound'
import { errorHandler } from './http/middleware/errorHandler'
import { healthRouter } from './http/routes/health'
import { teamsRouter } from './http/routes/teams'
import { invitationsRouter } from './http/routes/invitations'
import { authRouter } from './http/routes/auth'
import { itemsRouter } from './http/routes/items'
import { adminRouter } from './http/routes/admin'

export function createApp(): Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', config.trustProxy)
  app.use(requestId())
  app.use(requestLogger())
  app.use(express.json())
  app.use(healthRouter)
  app.use(teamsRouter)
  app.use(invitationsRouter)
  app.use(authRouter)
  app.use(itemsRouter)
  app.use(adminRouter)
  app.use(notFound())
  app.use(errorHandler())
  return app
}
