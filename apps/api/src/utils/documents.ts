import type {
  DocumentPermissions,
  DocumentDraftPayload,
  DocumentMemberRolePayload,
  DocumentMemberUpsertPayload,
  DocumentRole,
  DocumentVisibility,
} from '../types/document.js'
import { buildDocumentPermissions } from '@omde/shared'
import { HttpError } from './http.js'

const EMPTY_EXCERPT = 'Empty document'
const DOCUMENT_ROLES: DocumentRole[] = ['admin', 'editor', 'viewer']
const DOCUMENT_VISIBILITIES: DocumentVisibility[] = ['private', 'shared']

function isDocumentRole(value: string): value is DocumentRole {
  return DOCUMENT_ROLES.includes(value as DocumentRole)
}

function isDocumentVisibility(value: string): value is DocumentVisibility {
  return DOCUMENT_VISIBILITIES.includes(value as DocumentVisibility)
}

export function buildExcerpt(content: string) {
  const plainText = content
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return plainText.slice(0, 120) || EMPTY_EXCERPT
}

export function buildPermissions(role: DocumentRole): DocumentPermissions {
  return buildDocumentPermissions(role)
}

export function validateDraftPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    throw new HttpError(400, 'Request body must be a JSON object.')
  }

  const candidate = payload as Partial<DocumentDraftPayload>

  if (typeof candidate.title !== 'string' || typeof candidate.content !== 'string') {
    throw new HttpError(
      400,
      'Request body must include string fields "title" and "content".',
    )
  }

  const normalizedTitle = candidate.title.trim() || 'Untitled document'
  const normalizedVisibility =
    candidate.visibility && isDocumentVisibility(candidate.visibility)
      ? candidate.visibility
      : 'private'

  return {
    content: candidate.content,
    createRevision: candidate.createRevision === true,
    title: normalizedTitle,
    visibility: normalizedVisibility,
  } satisfies DocumentDraftPayload
}

export function validateMemberUpsertPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    throw new HttpError(400, 'Request body must be a JSON object.')
  }

  const candidate = payload as Partial<DocumentMemberUpsertPayload>

  if (
    typeof candidate.usernameOrEmail !== 'string' ||
    typeof candidate.role !== 'string' ||
    !isDocumentRole(candidate.role)
  ) {
    throw new HttpError(
      400,
      'Request body must include "usernameOrEmail" and a valid member "role".',
    )
  }

  return {
    role: candidate.role,
    usernameOrEmail: candidate.usernameOrEmail.trim(),
  } satisfies DocumentMemberUpsertPayload
}

export function validateMemberRolePayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    throw new HttpError(400, 'Request body must be a JSON object.')
  }

  const candidate = payload as Partial<DocumentMemberRolePayload>

  if (typeof candidate.role !== 'string' || !isDocumentRole(candidate.role)) {
    throw new HttpError(400, 'Request body must include a valid member "role".')
  }

  return {
    role: candidate.role,
  } satisfies DocumentMemberRolePayload
}
