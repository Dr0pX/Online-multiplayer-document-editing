export type DocumentRole = 'admin' | 'editor' | 'viewer'
export type SystemRole = 'user' | 'super_admin'

export interface DocumentPermissions {
  canDelete: boolean
  canEdit: boolean
  canManageMembers: boolean
}

export interface ResolvedDocumentAccess extends DocumentPermissions {
  canView: boolean
  currentUserRole: DocumentRole | null
  isOwner: boolean
  isSuperAdmin: boolean
}

export function buildDocumentPermissions(role: DocumentRole): DocumentPermissions {
  return {
    canDelete: role === 'admin',
    canEdit: role === 'admin' || role === 'editor',
    canManageMembers: role === 'admin',
  }
}

export function resolveDocumentAccess(input: {
  memberRole: DocumentRole | null
  ownerId: number
  systemRole: SystemRole
  userId: number
}): ResolvedDocumentAccess {
  const isOwner = input.ownerId === input.userId
  const isSuperAdmin = input.systemRole === 'super_admin'
  const currentUserRole = isOwner || isSuperAdmin ? 'admin' : input.memberRole

  if (!currentUserRole) {
    return {
      canDelete: false,
      canEdit: false,
      canManageMembers: false,
      canView: false,
      currentUserRole: null,
      isOwner,
      isSuperAdmin,
    }
  }

  return {
    ...buildDocumentPermissions(currentUserRole),
    canView: true,
    currentUserRole,
    isOwner,
    isSuperAdmin,
  }
}
