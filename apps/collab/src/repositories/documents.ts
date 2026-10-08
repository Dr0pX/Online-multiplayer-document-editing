import type { RowDataPacket } from 'mysql2/promise'
import * as Y from 'yjs'
import {
  createCollabSnapshotFromYDoc,
  createYDocFromHtml,
  resolveDocumentAccess,
} from '@omde/shared'
import { getDatabasePool } from '../lib/database.js'
import { collabConfig } from '../config/index.js'

interface SessionUserRow extends RowDataPacket {
  display_name: string
  email: string
  expires_at: Date | string
  revoked_at: Date | string | null
  session_id: number
  status: 'active' | 'disabled'
  system_role: 'user' | 'super_admin'
  user_id: number
  username: string
}

interface DocumentAccessRow extends RowDataPacket {
  id: string
  member_role: 'admin' | 'editor' | 'viewer' | null
  owner_id: number
}

interface DocumentContentRow extends RowDataPacket {
  content: string
}

interface CollabStateRow extends RowDataPacket {
  document_id: string
  state: Buffer
}

export interface CollabUser {
  displayName: string
  email: string
  id: number
  sessionId: number
  systemRole: 'user' | 'super_admin'
  username: string
}

export interface DocumentAccessContext {
  canEdit: boolean
  canView: boolean
  currentUserRole: 'admin' | 'editor' | 'viewer' | null
  documentId: string
  user: CollabUser
}

export async function findUserBySession(sessionId: number, userId: number) {
  const pool = getDatabasePool()
  const [rows] = await pool.query<SessionUserRow[]>(
    `
      SELECT
        s.id AS session_id,
        s.expires_at,
        s.revoked_at,
        u.id AS user_id,
        u.username,
        u.display_name,
        u.email,
        u.system_role,
        u.status
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

  return {
    displayName: row.display_name,
    email: row.email,
    id: row.user_id,
    sessionId: row.session_id,
    systemRole: row.system_role,
    username: row.username,
  } satisfies CollabUser
}

export async function findDocumentAccess(user: CollabUser, documentId: string) {
  const pool = getDatabasePool()
  const [rows] = await pool.query<DocumentAccessRow[]>(
    `
      SELECT
        d.id,
        d.owner_id,
        dm.role AS member_role
      FROM documents d
      LEFT JOIN document_members dm
        ON dm.document_id = d.id AND dm.user_id = ?
      WHERE d.id = ? AND d.deleted_at IS NULL
      LIMIT 1
    `,
    [user.id, documentId],
  )

  const row = rows[0]

  if (!row) {
    return null
  }

  const access = resolveDocumentAccess({
    memberRole: row.member_role,
    ownerId: row.owner_id,
    systemRole: user.systemRole,
    userId: user.id,
  })

  return {
    canEdit: access.canEdit,
    canView: access.canView,
    currentUserRole: access.currentUserRole,
    documentId: row.id,
    user,
  } satisfies DocumentAccessContext
}

export async function loadOrCreateCollabDocument(documentId: string) {
  const pool = getDatabasePool()
  const [stateRows] = await pool.query<CollabStateRow[]>(
    `
      SELECT document_id, yjs_state AS state
      FROM document_collab_states
      WHERE document_id = ?
      LIMIT 1
    `,
    [documentId],
  )

  const persistedState = stateRows[0]

  if (persistedState?.state) {
    const document = new Y.Doc()
    Y.applyUpdate(document, new Uint8Array(persistedState.state))
    return document
  }

  const [documentRows] = await pool.query<DocumentContentRow[]>(
    `
      SELECT content
      FROM documents
      WHERE id = ? AND deleted_at IS NULL
      LIMIT 1
    `,
    [documentId],
  )

  const documentRow = documentRows[0]

  if (!documentRow) {
    return new Y.Doc()
  }

  return createYDocFromHtml(
    documentRow.content,
    collabConfig.collaboration.documentFieldName,
  )
}

export async function persistCollabDocument(documentId: string, document: Y.Doc) {
  const pool = getDatabasePool()
  const snapshot = createCollabSnapshotFromYDoc(
    document,
    collabConfig.collaboration.documentFieldName,
  )
  const state = Buffer.from(snapshot.state)

  await pool.execute(
    `
      INSERT INTO document_collab_states (document_id, yjs_state)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE
        yjs_state = VALUES(yjs_state),
        updated_at = CURRENT_TIMESTAMP
    `,
    [documentId, state],
  )

  await pool.execute(
    `
      UPDATE documents
      SET content = ?, excerpt = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted_at IS NULL
    `,
    [snapshot.html, snapshot.excerpt, documentId],
  )
}
