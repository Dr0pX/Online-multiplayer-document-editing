export type DocumentRole = 'admin' | 'editor' | 'viewer'

export type DocumentVisibility = 'private' | 'shared'

export interface DocumentPermissions {
  canDelete: boolean
  canEdit: boolean
  canManageMembers: boolean
}

export interface DocumentSummary extends DocumentPermissions {
  currentUserRole: DocumentRole
  excerpt: string
  id: string
  ownerId: number
  ownerName: string
  title: string
  updatedAt: string
  visibility: DocumentVisibility
}

export interface DocumentMember {
  displayName: string
  email: string
  id: number
  isOwner: boolean
  joinedAt: string
  role: DocumentRole
  userId: number
  username: string
}

export interface DocumentRevision {
  createdAt: string
  editedByName: string | null
  excerptSnapshot: string
  id: number
  versionNumber: number
}

export interface RevisionRef {
  createdAt?: string
  editedByName?: string | null
  label: string
  version: number | 'current'
}

export interface DiffToken {
  op: 'equal' | 'insert' | 'delete'
  text: string
}

export interface RevisionDiffBlock {
  afterText: string
  beforeText: string
  blockId: string | null
  status: 'added' | 'removed' | 'modified' | 'unchanged'
  tokens?: DiffToken[]
  type: 'paragraph' | 'heading' | 'blockquote' | 'listItem' | 'unknown'
}

export interface RevisionDiffResult {
  afterTitle: string
  beforeTitle: string
  blocks: RevisionDiffBlock[]
  from: RevisionRef
  summary: {
    addedBlocks: number
    modifiedBlocks: number
    removedBlocks: number
    unchangedBlocks: number
  }
  titleTokens: DiffToken[]
  to: RevisionRef
}

export interface DocumentRecord extends DocumentSummary {
  content: string
  members: DocumentMember[]
  revisions: DocumentRevision[]
}

export interface DocumentDraftPayload {
  content: string
  createRevision?: boolean
  title: string
  visibility?: DocumentVisibility
}

export interface DocumentMemberUpsertPayload {
  role: DocumentRole
  usernameOrEmail: string
}

export interface DocumentMemberRolePayload {
  role: DocumentRole
}
