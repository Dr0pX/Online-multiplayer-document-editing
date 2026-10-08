import type {
  CreateDocumentPayload,
  DocumentDraftPayload,
  DocumentMember,
  DocumentMemberUpsertPayload,
  DocumentRecord,
  DocumentRevision,
  RevisionDiffResult,
  DocumentRole,
  DocumentSummary,
} from '../../types/document'
import { request } from '../http/client'

export async function createDocument(payload: CreateDocumentPayload) {
  return request<DocumentRecord>('/documents', {
    body: JSON.stringify(payload),
    method: 'POST',
  })
}

export async function deleteDocument(documentId: string) {
  return request<void>(`/documents/${documentId}`, {
    method: 'DELETE',
  })
}

export async function getDocumentById(id: string) {
  return request<DocumentRecord>(`/documents/${id}`)
}

export async function listDocumentRevisions(documentId: string) {
  return request<DocumentRevision[]>(`/documents/${documentId}/revisions`)
}

export async function compareDocumentRevisions(
  documentId: string,
  from: number | 'current',
  to: number | 'current',
) {
  return request<RevisionDiffResult>(`/documents/${documentId}/revisions/compare`, {
    query: {
      from,
      to,
    },
  })
}

export async function listDocuments() {
  return request<DocumentSummary[]>('/documents')
}

export async function removeDocumentMember(documentId: string, memberId: number) {
  return request<void>(`/documents/${documentId}/members/${memberId}`, {
    method: 'DELETE',
  })
}

export async function saveDocumentDraft(payload: DocumentDraftPayload) {
  return request<DocumentRecord>(`/documents/${payload.id}`, {
    body: JSON.stringify({
      content: payload.content,
      createRevision: payload.createRevision,
      title: payload.title,
      visibility: payload.visibility,
    }),
    method: 'PATCH',
  })
}

export async function searchDocuments(keyword: string) {
  return request<DocumentSummary[]>('/documents', {
    query: {
      q: keyword,
    },
  })
}

export async function upsertDocumentMember(
  documentId: string,
  payload: DocumentMemberUpsertPayload,
) {
  return request<DocumentMember[]>(`/documents/${documentId}/members`, {
    body: JSON.stringify(payload),
    method: 'POST',
  })
}

export async function updateDocumentMemberRole(
  documentId: string,
  memberId: number,
  role: DocumentRole,
) {
  return request<DocumentMember[]>(`/documents/${documentId}/members/${memberId}`, {
    body: JSON.stringify({ role }),
    method: 'PATCH',
  })
}
