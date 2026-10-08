export type SystemRole = 'user' | 'super_admin'

export interface AuthUser {
  displayName: string
  email: string
  id: number
  status: 'active' | 'disabled'
  systemRole: SystemRole
  username: string
}

export interface AuthSession {
  accessToken: string
  accessTokenExpiresAt: string
  user: AuthUser
}
