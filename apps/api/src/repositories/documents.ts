import { randomUUID } from 'node:crypto'
import {
  compareRevisionSnapshots,
  createCollabSnapshotFromHtml,
  resolveDocumentAccess,
} from '@omde/shared'
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise'
import { getDatabasePool } from '../lib/database.js'
import type { AuthUser } from '../types/auth.js'
import type {
  DocumentDraftPayload,
  DocumentMember,
  DocumentRecord,
  RevisionDiffResult,
  DocumentRevision,
  DocumentRole,
  DocumentSummary,
} from '../types/document.js'
import { HttpError } from '../utils/http.js'
import { notifyCollabToReconnectDocument } from '../utils/collab.js'
import { findUserForMemberLookup } from './auth.js'

type DatabaseExecutor = Pool | PoolConnection

interface DocumentAccessRow extends RowDataPacket {
  id: string
  member_role: DocumentRole | null
  owner_id: number
}

interface DocumentSummaryRow extends RowDataPacket {
  excerpt: string
  id: string
  member_role: DocumentRole | null
  owner_id: number
  owner_name: string
  title: string
  updated_at: Date | string
  visibility: 'private' | 'shared'
}

interface DocumentDetailRow extends DocumentSummaryRow {
  content: string
}

interface DocumentMemberRow extends RowDataPacket {
  created_at: Date | string
  display_name: string
  email: string
  id: number
  is_owner: 0 | 1
  role: DocumentRole
  user_id: number
  username: string
}

interface DocumentRevisionRow extends RowDataPacket {
  created_at: Date | string
  edited_by_name: string | null
  excerpt_snapshot: string
  id: number
  version_number: number
}

interface DocumentRevisionSnapshotRow extends RowDataPacket {
  content_snapshot: string
  created_at: Date | string
  edited_by_name: string | null
  title_snapshot: string
  version_number: number
}

interface CurrentDocumentSnapshotRow extends RowDataPacket {
  content: string
  title: string
  updated_at: Date | string
}

interface DocumentAccessContext {
  canDelete: boolean
  canEdit: boolean
  canManageMembers: boolean
  canView: boolean
  currentUserRole: DocumentRole | null
  documentId: string
  ownerId: number
}

function createDocumentId() {
  return `doc-${randomUUID().replace(/-/g, '').slice(0, 20)}`
}

function mapMember(row: DocumentMemberRow): DocumentMember {
  return {
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    isOwner: row.is_owner === 1,
    joinedAt: new Date(row.created_at).toISOString(),
    role: row.role,
    userId: row.user_id,
    username: row.username,
  }
}

function mapRevision(row: DocumentRevisionRow): DocumentRevision {
  return {
    createdAt: new Date(row.created_at).toISOString(),
    editedByName: row.edited_by_name,
    excerptSnapshot: row.excerpt_snapshot,
    id: row.id,
    versionNumber: row.version_number,
  }
}

function mapSummary(row: DocumentSummaryRow, user: AuthUser): DocumentSummary {
  const access = resolveDocumentAccess({
    memberRole: row.member_role,
    ownerId: row.owner_id,
    systemRole: user.systemRole,
    userId: user.id,
  })

  if (!access.currentUserRole) {
    throw new HttpError(500, 'Document summary was resolved without a readable role.')
  }

  return {
    canDelete: access.canDelete,
    canEdit: access.canEdit,
    canManageMembers: access.canManageMembers,
    currentUserRole: access.currentUserRole,
    excerpt: row.excerpt,
    id: row.id,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    title: row.title,
    updatedAt: new Date(row.updated_at).toISOString(),
    visibility: row.visibility,
  }
}

async function getDocumentMembers(executor: DatabaseExecutor, documentId: string) {
  const [rows] = await executor.query<DocumentMemberRow[]>(
    `
      SELECT
        dm.id,
        dm.user_id,
        dm.role,
        dm.created_at,
        u.username,
        u.display_name,
        u.email,
        CASE WHEN d.owner_id = dm.user_id THEN 1 ELSE 0 END AS is_owner
      FROM document_members dm
      INNER JOIN users u ON u.id = dm.user_id
      INNER JOIN documents d ON d.id = dm.document_id
      WHERE dm.document_id = ?
      ORDER BY is_owner DESC, dm.created_at ASC
    `,
    [documentId],
  )

  return rows.map(mapMember)
}

async function getDocumentRevisions(executor: DatabaseExecutor, documentId: string) {
  const [rows] = await executor.query<DocumentRevisionRow[]>(
    `
      SELECT
        r.id,
        r.version_number,
        r.excerpt_snapshot,
        r.created_at,
        u.display_name AS edited_by_name
      FROM document_revisions r
      LEFT JOIN users u ON u.id = r.edited_by
      WHERE r.document_id = ?
      ORDER BY r.version_number DESC
      LIMIT 12
    `,
    [documentId],
  )

  return rows.map(mapRevision)
}

async function getNextRevisionNumber(executor: DatabaseExecutor, documentId: string) {
  const [rows] = await executor.query<Array<RowDataPacket & { next_version: number }>>(
    `
      SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
      FROM document_revisions
      WHERE document_id = ?
    `,
    [documentId],
  )

  return rows[0]?.next_version ?? 1
}

async function getRevisionSnapshotByVersionNumber(
  executor: DatabaseExecutor,
  documentId: string,
  versionNumber: number,
) {
  const [rows] = await executor.query<DocumentRevisionSnapshotRow[]>(
    `
      SELECT
        r.version_number,
        r.title_snapshot,
        r.content_snapshot,
        r.created_at,
        u.display_name AS edited_by_name
      FROM document_revisions r
      LEFT JOIN users u ON u.id = r.edited_by
      WHERE r.document_id = ? AND r.version_number = ?
      LIMIT 1
    `,
    [documentId, versionNumber],
  )

  const row = rows[0]

  if (!row) {
    return null
  }

  return {
    content: row.content_snapshot,
    ref: {
      createdAt: new Date(row.created_at).toISOString(),
      editedByName: row.edited_by_name,
      label: `Version ${row.version_number}`,
      version: row.version_number,
    },
    title: row.title_snapshot,
  }
}

async function getCurrentDocumentSnapshot(
  executor: DatabaseExecutor,
  documentId: string,
) {
  const [rows] = await executor.query<CurrentDocumentSnapshotRow[]>(
    `
      SELECT title, content, updated_at
      FROM documents
      WHERE id = ? AND deleted_at IS NULL
      LIMIT 1
    `,
    [documentId],
  )

  const row = rows[0]

  if (!row) {
    return null
  }

  return {
    content: row.content,
    ref: {
      createdAt: new Date(row.updated_at).toISOString(),
      editedByName: null,
      label: 'Current version',
      version: 'current' as const,
    },
    title: row.title,
  }
}

async function insertAuditLog(
  executor: DatabaseExecutor,
  payload: {
    action: string
    documentId: string | null
    metadata?: Record<string, unknown>
    userId: number | null
  },
) {
  await executor.execute(
    `
      INSERT INTO audit_logs (user_id, document_id, action, metadata)
      VALUES (?, ?, ?, ?)
    `,
    [
      payload.userId,
      payload.documentId,
      payload.action,
      payload.metadata ? JSON.stringify(payload.metadata) : null,
    ],
  )
}

async function notifyCollabReconnect(documentId: string) {
  try {
    await notifyCollabToReconnectDocument(documentId)
  } catch (error) {
    console.warn(
      `Failed to request immediate collab reconnect for document ${documentId}. Falling back to periodic permission revalidation.`,
    )
    console.warn(error)
  }
}

export async function findDocumentAccessContext(user: AuthUser, documentId: string) {
  const pool = getDatabasePool()
  const [rows] = await pool.query<DocumentAccessRow[]>(
    `
      SELECT d.id, d.owner_id, dm.role AS member_role
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
    canDelete: access.canDelete,
    canEdit: access.canEdit,
    canManageMembers: access.canManageMembers,
    canView: access.canView,
    currentUserRole: access.currentUserRole,
    documentId: row.id,
    ownerId: row.owner_id,
  } satisfies DocumentAccessContext
}

export async function listDocuments(user: AuthUser, keyword?: string) {
  const pool = getDatabasePool()
  const normalizedKeyword = keyword?.trim()
  const likeKeyword = normalizedKeyword ? `%${normalizedKeyword}%` : null

  const [rows] = await pool.query<DocumentSummaryRow[]>(
    `
      SELECT
        d.id,
        d.title,
        d.excerpt,
        d.owner_id,
        d.visibility,
        d.updated_at,
        owner.display_name AS owner_name,
        dm.role AS member_role
      FROM documents d
      INNER JOIN users owner ON owner.id = d.owner_id
      LEFT JOIN document_members dm
        ON dm.document_id = d.id AND dm.user_id = ?
      WHERE
        d.deleted_at IS NULL
        AND (? = 'super_admin' OR d.owner_id = ? OR dm.user_id IS NOT NULL)
        AND (
          ? IS NULL
          OR d.title LIKE ?
          OR d.excerpt LIKE ?
        )
      ORDER BY d.updated_at DESC
    `,
    [
      user.id,
      user.systemRole,
      user.id,
      likeKeyword,
      likeKeyword,
      likeKeyword,
    ],
  )

  return rows.map((row) => mapSummary(row, user))
}

export async function findDocumentById(user: AuthUser, documentId: string) {
  const access = await findDocumentAccessContext(user, documentId)

  if (!access) {
    return null
  }

  if (!access.canView || !access.currentUserRole) {
    throw new HttpError(403, 'You do not have permission to view this document.')
  }

  const pool = getDatabasePool()
  const [rows] = await pool.query<DocumentDetailRow[]>(
    `
      SELECT
        d.id,
        d.title,
        d.content,
        d.excerpt,
        d.owner_id,
        d.visibility,
        d.updated_at,
        owner.display_name AS owner_name,
        ? AS member_role
      FROM documents d
      INNER JOIN users owner ON owner.id = d.owner_id
      WHERE d.id = ? AND d.deleted_at IS NULL
      LIMIT 1
    `,
    [access.currentUserRole, documentId],
  )

  const row = rows[0]

  if (!row) {
    return null
  }

  const [members, revisions] = await Promise.all([
    getDocumentMembers(pool, documentId),
    getDocumentRevisions(pool, documentId),
  ])

  return {
    ...mapSummary(row, user),
    content: row.content,
    members,
    revisions,
  } satisfies DocumentRecord
}

export async function createDocument(user: AuthUser, payload: DocumentDraftPayload) {
  const pool = getDatabasePool()
  const connection = await pool.getConnection()
  const documentId = createDocumentId()
  const collabSnapshot = createCollabSnapshotFromHtml(payload.content)

  try {
    await connection.beginTransaction()

    await connection.execute(
      `
        INSERT INTO documents (id, title, content, excerpt, owner_id, visibility)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        documentId,
        payload.title,
        collabSnapshot.html,
        collabSnapshot.excerpt,
        user.id,
        payload.visibility ?? 'private',
      ],
    )

    await connection.execute(
      `
        INSERT INTO document_members (document_id, user_id, role)
        VALUES (?, ?, 'admin')
      `,
      [documentId, user.id],
    )

    await connection.execute(
      `
        INSERT INTO document_collab_states (document_id, yjs_state)
        VALUES (?, ?)
      `,
      [documentId, Buffer.from(collabSnapshot.state)],
    )

    await connection.execute(
      `
        INSERT INTO document_revisions (
          document_id,
          version_number,
          title_snapshot,
          content_snapshot,
          excerpt_snapshot,
          edited_by
        )
        VALUES (?, 1, ?, ?, ?, ?)
      `,
      [
        documentId,
        payload.title,
        collabSnapshot.html,
        collabSnapshot.excerpt,
        user.id,
      ],
    )

    await insertAuditLog(connection, {
      action: 'document_created',
      documentId,
      metadata: {
        title: payload.title,
        visibility: payload.visibility ?? 'private',
      },
      userId: user.id,
    })

    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  return findDocumentById(user, documentId)
}

export async function updateDocumentById(
  user: AuthUser,
  documentId: string,
  payload: DocumentDraftPayload,
) {
  const access = await findDocumentAccessContext(user, documentId)

  if (!access) {
    return null
  }

  if (!access.canEdit) {
    throw new HttpError(403, 'You do not have permission to edit this document.')
  }

  const pool = getDatabasePool()
  const connection = await pool.getConnection()
  const collabSnapshot = createCollabSnapshotFromHtml(payload.content)

  try {
    await connection.beginTransaction()

    const [result] = await connection.execute<ResultSetHeader>(
      `
        UPDATE documents
        SET title = ?, content = ?, excerpt = ?, visibility = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND deleted_at IS NULL
      `,
      [
        payload.title,
        collabSnapshot.html,
        collabSnapshot.excerpt,
        payload.visibility ?? 'private',
        documentId,
      ],
    )

    if (result.affectedRows === 0) {
      await connection.rollback()
      return null
    }

    if (payload.createRevision) {
      const nextVersionNumber = await getNextRevisionNumber(connection, documentId)

      await connection.execute(
        `
          INSERT INTO document_revisions (
            document_id,
            version_number,
            title_snapshot,
            content_snapshot,
            excerpt_snapshot,
            edited_by
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          documentId,
          nextVersionNumber,
          payload.title,
          collabSnapshot.html,
          collabSnapshot.excerpt,
          user.id,
        ],
      )
    }

    await connection.execute(
      `
        INSERT INTO document_collab_states (document_id, yjs_state)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE
          yjs_state = VALUES(yjs_state),
          updated_at = CURRENT_TIMESTAMP
      `,
      [documentId, Buffer.from(collabSnapshot.state)],
    )

    await insertAuditLog(connection, {
      action: 'document_updated',
      documentId,
      metadata: {
        changedFields: ['title', 'content', 'excerpt', 'visibility'],
        createRevision: payload.createRevision === true,
      },
      userId: user.id,
    })

    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  return findDocumentById(user, documentId)
}

export async function deleteDocumentById(user: AuthUser, documentId: string) {
  const access = await findDocumentAccessContext(user, documentId)

  if (!access) {
    return false
  }

  if (!access.canDelete) {
    throw new HttpError(403, 'You do not have permission to delete this document.')
  }

  const pool = getDatabasePool()
  const [result] = await pool.execute<ResultSetHeader>(
    `
      UPDATE documents
      SET deleted_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted_at IS NULL
    `,
    [documentId],
  )

  if (result.affectedRows > 0) {
    await insertAuditLog(pool, {
      action: 'document_deleted',
      documentId,
      metadata: undefined,
      userId: user.id,
    })

    await notifyCollabReconnect(documentId)
  }

  return result.affectedRows > 0
}

export async function upsertDocumentMember(
  user: AuthUser,
  documentId: string,
  payload: {
    role: DocumentRole
    usernameOrEmail: string
  },
) {
  const access = await findDocumentAccessContext(user, documentId)

  if (!access) {
    return null
  }

  if (!access.canManageMembers) {
    throw new HttpError(403, 'You do not have permission to manage document members.')
  }

  const targetUser = await findUserForMemberLookup(payload.usernameOrEmail)

  if (!targetUser) {
    throw new HttpError(404, 'Target user was not found.')
  }

  if (targetUser.status !== 'active') {
    throw new HttpError(400, 'Target user is not active.')
  }

  const pool = getDatabasePool()
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    await connection.execute(
      `
        INSERT INTO document_members (document_id, user_id, role)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE role = VALUES(role)
      `,
      [documentId, targetUser.id, payload.role],
    )

    await insertAuditLog(connection, {
      action: 'member_upserted',
      documentId,
      metadata: {
        role: payload.role,
        targetUserId: targetUser.id,
      },
      userId: user.id,
    })

    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  await notifyCollabReconnect(documentId)

  return getDocumentMembers(pool, documentId)
}

export async function updateDocumentMemberRole(
  user: AuthUser,
  documentId: string,
  memberId: number,
  role: DocumentRole,
) {
  const access = await findDocumentAccessContext(user, documentId)

  if (!access) {
    return null
  }

  if (!access.canManageMembers) {
    throw new HttpError(403, 'You do not have permission to manage document members.')
  }

  const pool = getDatabasePool()
  const [rows] = await pool.query<DocumentMemberRow[]>(
    `
      SELECT
        dm.id,
        dm.user_id,
        dm.role,
        dm.created_at,
        u.username,
        u.display_name,
        u.email,
        CASE WHEN d.owner_id = dm.user_id THEN 1 ELSE 0 END AS is_owner
      FROM document_members dm
      INNER JOIN users u ON u.id = dm.user_id
      INNER JOIN documents d ON d.id = dm.document_id
      WHERE dm.id = ? AND dm.document_id = ?
      LIMIT 1
    `,
    [memberId, documentId],
  )

  const member = rows[0]

  if (!member) {
    return null
  }

  if (member.is_owner === 1) {
    throw new HttpError(400, 'The document owner must remain an admin member.')
  }

  await pool.execute(
    `
      UPDATE document_members
      SET role = ?
      WHERE id = ?
    `,
    [role, memberId],
  )

  await insertAuditLog(pool, {
    action: 'member_role_updated',
    documentId,
    metadata: {
      memberId,
      role,
      targetUserId: member.user_id,
    },
    userId: user.id,
  })

  await notifyCollabReconnect(documentId)

  return getDocumentMembers(pool, documentId)
}

export async function removeDocumentMember(
  user: AuthUser,
  documentId: string,
  memberId: number,
) {
  const access = await findDocumentAccessContext(user, documentId)

  if (!access) {
    return false
  }

  if (!access.canManageMembers) {
    throw new HttpError(403, 'You do not have permission to manage document members.')
  }

  const pool = getDatabasePool()
  const [rows] = await pool.query<DocumentMemberRow[]>(
    `
      SELECT
        dm.id,
        dm.user_id,
        dm.role,
        dm.created_at,
        u.username,
        u.display_name,
        u.email,
        CASE WHEN d.owner_id = dm.user_id THEN 1 ELSE 0 END AS is_owner
      FROM document_members dm
      INNER JOIN users u ON u.id = dm.user_id
      INNER JOIN documents d ON d.id = dm.document_id
      WHERE dm.id = ? AND dm.document_id = ?
      LIMIT 1
    `,
    [memberId, documentId],
  )

  const member = rows[0]

  if (!member) {
    return false
  }

  if (member.is_owner === 1) {
    throw new HttpError(400, 'The document owner cannot be removed.')
  }

  const [result] = await pool.execute<ResultSetHeader>(
    `
      DELETE FROM document_members
      WHERE id = ?
    `,
    [memberId],
  )

  if (result.affectedRows > 0) {
    await insertAuditLog(pool, {
      action: 'member_removed',
      documentId,
      metadata: {
        memberId,
        targetUserId: member.user_id,
      },
      userId: user.id,
    })

    await notifyCollabReconnect(documentId)
  }

  return result.affectedRows > 0
}

export async function listDocumentMembers(user: AuthUser, documentId: string) {
  const access = await findDocumentAccessContext(user, documentId)

  if (!access) {
    return null
  }

  if (!access.canView) {
    throw new HttpError(403, 'You do not have permission to view document members.')
  }

  return getDocumentMembers(getDatabasePool(), documentId)
}

export async function listDocumentRevisions(user: AuthUser, documentId: string) {
  const access = await findDocumentAccessContext(user, documentId)

  if (!access) {
    return null
  }

  if (!access.canView) {
    throw new HttpError(403, 'You do not have permission to view document revisions.')
  }

  return getDocumentRevisions(getDatabasePool(), documentId)
}

export async function compareDocumentRevisions(
  user: AuthUser,
  documentId: string,
  fromVersion: number | 'current',
  toVersion: number | 'current',
) {
  const access = await findDocumentAccessContext(user, documentId)

  if (!access) {
    return null
  }

  if (!access.canView) {
    throw new HttpError(403, 'You do not have permission to view document revisions.')
  }

  if (fromVersion === 'current' && toVersion === 'current') {
    throw new HttpError(400, 'At least one side of the comparison must be a saved revision.')
  }

  const pool = getDatabasePool()

  const [fromSnapshot, toSnapshot] = await Promise.all([
    fromVersion === 'current'
      ? getCurrentDocumentSnapshot(pool, documentId)
      : getRevisionSnapshotByVersionNumber(pool, documentId, fromVersion),
    toVersion === 'current'
      ? getCurrentDocumentSnapshot(pool, documentId)
      : getRevisionSnapshotByVersionNumber(pool, documentId, toVersion),
  ])

  if (!fromSnapshot) {
    throw new HttpError(404, `Source revision ${String(fromVersion)} was not found.`)
  }

  if (!toSnapshot) {
    throw new HttpError(404, `Target revision ${String(toVersion)} was not found.`)
  }

  return compareRevisionSnapshots(fromSnapshot, toSnapshot) satisfies RevisionDiffResult
}
