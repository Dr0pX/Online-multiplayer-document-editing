export type SystemRole = 'user' | 'super_admin'

export interface AuthUser {
  displayName: string
  email: string
  id: number
  status: 'active' | 'disabled'
  systemRole: SystemRole
  username: string
}

export interface AuthResponse {
  accessToken: string
  accessTokenExpiresAt: string
  user: AuthUser
}

export interface LoginPayload {
  login: string
  password: string
}

export interface RegisterPayload {
  displayName: string
  email: string
  password: string
  username: string
}
