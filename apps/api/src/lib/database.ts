import mysql from 'mysql2/promise'
import { ENSURE_DOCUMENT_COLLAB_STATES_SQL } from '@omde/shared'
import { appConfig } from '../config/index.js'

let pool: mysql.Pool | null = null

export function getDatabasePool() {
  if (!pool) {
    pool = mysql.createPool({
      host: appConfig.database.host,
      port: appConfig.database.port,
      user: appConfig.database.user,
      password: appConfig.database.password,
      database: appConfig.database.database,
      connectionLimit: appConfig.database.connectionLimit,
      charset: 'utf8mb4',
    })
  }

  return pool
}

export async function verifyDatabaseConnection() {
  const databasePool = getDatabasePool()
  const connection = await databasePool.getConnection()

  try {
    await connection.ping()
  } finally {
    connection.release()
  }
}

export async function ensureCollaborationSchema() {
  const databasePool = getDatabasePool()
  await databasePool.execute(ENSURE_DOCUMENT_COLLAB_STATES_SQL)
}
