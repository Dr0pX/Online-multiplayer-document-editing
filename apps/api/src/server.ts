import { createApp } from './app.js'
import { appConfig } from './config/index.js'
import {
  ensureCollaborationSchema,
  verifyDatabaseConnection,
} from './lib/database.js'

async function bootstrap() {
  await verifyDatabaseConnection()
  await ensureCollaborationSchema()

  const app = createApp()

  app.listen(appConfig.server.port, () => {
    console.log(`API server listening on http://localhost:${appConfig.server.port}`)
  })
}

bootstrap().catch((error) => {
  console.error('Failed to start API server.')
  console.error(error)
  process.exit(1)
})
