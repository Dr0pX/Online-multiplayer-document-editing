import { createPool, type Pool } from 'mysql2/promise'
import { ENSURE_DOCUMENT_COLLAB_STATES_SQL } from '@omde/shared'
import { collabConfig } from '../config/index.js'

let databasePool: Pool | null = null

export function getDatabasePool() {
  if (!databasePool) {
    databasePool = createPool({
      host: collabConfig.database.host,
      port: collabConfig.database.port,
      user: collabConfig.database.user,
      password: collabConfig.database.password,
      database: collabConfig.database.database,
      connectionLimit: collabConfig.database.connectionLimit,
    })
  }

  return databasePool
}

export async function ensureCollaborationSchema() {
  const pool = getDatabasePool()
  await pool.execute(ENSURE_DOCUMENT_COLLAB_STATES_SQL)
}
