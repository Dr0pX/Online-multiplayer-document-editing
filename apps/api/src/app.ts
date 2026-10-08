import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import { appConfig } from './config/index.js'
import { requireAuth } from './middleware/auth.js'
import { authRouter } from './routes/auth.js'
import { documentsRouter } from './routes/documents.js'
import { isHttpError } from './utils/http.js'

export function createApp() {
  const app = express()

  app.use(
    cors({
      credentials: true,
      origin: appConfig.cors.origin,
    }),
  )
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' })
  })

  app.use('/api/auth', authRouter)
  app.use('/api/documents', requireAuth, documentsRouter)

  app.use((_request, response) => {
    response.status(404).json({ message: 'Route not found.' })
  })

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'Internal server error.'
    const statusCode = isHttpError(error) ? error.statusCode : 500

    response.status(statusCode).json({ message })
  })

  return app
}
