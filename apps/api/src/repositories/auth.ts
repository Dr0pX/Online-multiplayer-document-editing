import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { getDatabasePool } from '../lib/database.js'
import type { AuthUser, RegisterPayload } from '../types/auth.js'
import { HttpError } from '../utils/http.js'

interface AuthUserRow extends RowDataPacket {
  display_name: string
  email: string
  id: number
  password_hash: string
  status: 'active' | 'disabled'
  system_role: 'user' | 'super_admin'
  username: string
}

interface SessionUserRow extends AuthUserRow {
  session_id: number
  expires_at: Date | string
  revoked_at: Date | string | null
}

function mapAuthUser(row: AuthUserRow): AuthUser {
  return {
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    status: row.status,
    systemRole: row.system_role,
    username: row.username,
  }
}

export async function createUser(
  payload: RegisterPayload & {
    passwordHash: string
  },
) {
  const pool = getDatabasePool()

  try {
    const [result] = await pool.execute<ResultSetHeader>(
      `
        INSERT INTO users (username, display_name, email, password_hash)
        VALUES (?, ?, ?, ?)
      `,
      [payload.username, payload.displayName, payload.email, payload.passwordHash],
    )

    return findUserById(result.insertId)
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ER_DUP_ENTRY'
    ) {
      throw new HttpError(409, 'Username or email already exists.')
    }

    throw error
  }
}

export async function createUserSession(
  userId: number,
  tokenHash: string,
  expiresAt: Date,
  userAgent: string | null,
  ipAddress: string | null,
) {
  const pool = getDatabasePool()

  const [result] = await pool.execute<ResultSetHeader>(
    `
      INSERT INTO sessions (user_id, token_hash, user_agent, ip_address, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    [userId, tokenHash, userAgent, ipAddress, expiresAt],
  )

  return result.insertId
}

export async function findUserById(id: number) {
  const pool = getDatabasePool()
  const [rows] = await pool.query<AuthUserRow[]>(
    `
      SELECT id, username, display_name, email, password_hash, system_role, status
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [id],
  )

  const row = rows[0]

  return row
    ? {
        passwordHash: row.password_hash,
        user: mapAuthUser(row),
      }
    : null
}

export async function findUserByLogin(login: string) {
  const pool = getDatabasePool()
  const normalizedLogin = login.trim()
  const [rows] = await pool.query<AuthUserRow[]>(
    `
      SELECT id, username, display_name, email, password_hash, system_role, status
      FROM users
      WHERE username = ? OR email = ?
      LIMIT 1
    `,
    [normalizedLogin, normalizedLogin],
  )

  const row = rows[0]

  return row
    ? {
        passwordHash: row.password_hash,
        user: mapAuthUser(row),
      }
    : null
}

export async function findUserBySessionTokenHash(tokenHash: string) {
  const pool = getDatabasePool()
  const [rows] = await pool.query<SessionUserRow[]>(
    `
      SELECT
        s.id AS session_id,
        u.id,
        u.username,
        u.display_name,
        u.email,
        u.password_hash,
        u.system_role,
        u.status,
        s.expires_at,
        s.revoked_at
      FROM sessions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
      LIMIT 1
    `,
    [tokenHash],
  )

  const row = rows[0]

  if (!row) {
    return null
  }

  if (row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
    return null
  }

  return {
    expiresAt: new Date(row.expires_at),
    id: row.session_id,
    user: mapAuthUser(row),
  }
}

export async function findUserBySessionId(sessionId: number, userId: number) {
  const pool = getDatabasePool()
  const [rows] = await pool.query<SessionUserRow[]>(
    `
      SELECT
        s.id AS session_id,
        u.id,
        u.username,
        u.display_name,
        u.email,
        u.password_hash,
        u.system_role,
        u.status,
        s.expires_at,
        s.revoked_at
      FROM sessions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.user_id = ?
      LIMIT 1
    `,
    [sessionId, userId],
  )

  const row = rows[0]

  if (!row) {
    return null
  }

  if (
    row.revoked_at ||
    row.status !== 'active' ||
    new Date(row.expires_at).getTime() <= Date.now()
  ) {
    return null
  }

  return mapAuthUser(row)
}

export async function findUserForMemberLookup(usernameOrEmail: string) {
  const pool = getDatabasePool()
  const normalizedLookup = usernameOrEmail.trim()
  const [rows] = await pool.query<AuthUserRow[]>(
    `
      SELECT id, username, display_name, email, password_hash, system_role, status
      FROM users
      WHERE username = ? OR email = ?
      LIMIT 1
    `,
    [normalizedLookup, normalizedLookup],
  )

  const row = rows[0]

  return row ? mapAuthUser(row) : null
}

export async function revokeUserSession(tokenHash: string) {
  const pool = getDatabasePool()

  await pool.execute(
    `
      UPDATE sessions
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE token_hash = ? AND revoked_at IS NULL
    `,
    [tokenHash],
  )
}

export async function revokeUserSessionById(sessionId: number) {
  const pool = getDatabasePool()

  await pool.execute(
    `
      UPDATE sessions
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE id = ? AND revoked_at IS NULL
    `,
    [sessionId],
  )
}
