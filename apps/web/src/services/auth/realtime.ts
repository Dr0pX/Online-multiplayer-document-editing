import { refreshAccessToken } from '../http/client'
import { getAccessToken } from './session'

const ACCESS_TOKEN_REFRESH_SKEW_MS = 30_000

interface AccessTokenPayload {
  exp: number
}

function decodeAccessTokenPayload(token: string) {
  const [, encodedPayload] = token.split('.')

  if (!encodedPayload) {
    return null
  }

  try {
    const normalized = encodedPayload
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(encodedPayload.length / 4) * 4, '=')

    const decoded = window.atob(normalized)
    return JSON.parse(decoded) as Partial<AccessTokenPayload>
  } catch {
    return null
  }
}

function isTokenExpiringSoon(token: string) {
  const payload = decodeAccessTokenPayload(token)

  if (typeof payload?.exp !== 'number') {
    return true
  }

  return payload.exp * 1000 <= Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS
}

export async function getRealtimeAccessToken() {
  const currentToken = getAccessToken()

  if (currentToken && !isTokenExpiringSoon(currentToken)) {
    return currentToken
  }

  const refreshedToken = await refreshAccessToken()
  return refreshedToken ?? currentToken ?? ''
}
