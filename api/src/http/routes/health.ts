import { Router, type Request, type Response } from 'express'
import { pool } from '../../db/client'

export const healthRouter: Router = Router()

healthRouter.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' })
})

healthRouter.get('/ready', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1')
    res.status(200).json({ status: 'ready' })
  } catch {
    res.status(503).json({ status: 'unready' })
  }
})
