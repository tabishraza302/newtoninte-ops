import express, { type Express } from 'express'
import { requestId } from './http/middleware/requestId'
import { notFound } from './http/middleware/notFound'
import { errorHandler } from './http/middleware/errorHandler'
import { healthRouter } from './http/routes/health'
import { teamsRouter } from './http/routes/teams'
import { invitationsRouter } from './http/routes/invitations'
import { authRouter } from './http/routes/auth'

export function createApp(): Express {
  const app = express()
  app.use(requestId())
  app.use(express.json())
  app.use(healthRouter)
  app.use(teamsRouter)
  app.use(invitationsRouter)
  app.use(authRouter)
  app.use(notFound())
  app.use(errorHandler())
  return app
}
