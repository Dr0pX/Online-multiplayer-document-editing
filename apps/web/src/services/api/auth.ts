import type { AuthSession, AuthUser } from '../../types/auth'
import { request } from '../http/client'

interface LoginPayload {
  login: string
  password: string
}

interface RegisterPayload {
  displayName: string
  email: string
  password: string
  username: string
}

export async function getCurrentUser() {
  const response = await request<{ user: AuthUser }>('/auth/me')

  return response.user
}

export async function login(payload: LoginPayload) {
  return request<AuthSession>('/auth/login', {
    body: JSON.stringify(payload),
    method: 'POST',
    skipAuth: true,
  })
}

export async function logout() {
  return request<void>('/auth/logout', {
    method: 'POST',
    retryOnUnauthorized: false,
    skipAuth: true,
  })
}

export async function register(payload: RegisterPayload) {
  return request<AuthSession>('/auth/register', {
    body: JSON.stringify(payload),
    method: 'POST',
    skipAuth: true,
  })
}

export async function refreshSession() {
  return request<AuthSession>('/auth/refresh', {
    method: 'POST',
    retryOnUnauthorized: false,
    skipAuth: true,
  })
}
