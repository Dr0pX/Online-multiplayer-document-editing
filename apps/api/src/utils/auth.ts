import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)
const OPAQUE_TOKEN_BYTES = 32
const SCRYPT_KEY_LENGTH = 64
const SCRYPT_PREFIX = 'scrypt'
const ACCESS_TOKEN_VERSION = 1

interface AccessTokenPayload {
  exp: number
  iat: number
  sid: number
  uid: number
  v: number
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function encodeBase64Url(value: string) {
  return Buffer.from(value).toString('base64url')
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

export function createOpaqueToken() {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString('hex')
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function createAccessToken(
  payload: {
    expiresAt: Date
    sessionId: number
    userId: number
  },
  secret: string,
) {
  const serializedPayload = JSON.stringify({
    exp: Math.floor(payload.expiresAt.getTime() / 1000),
    iat: Math.floor(Date.now() / 1000),
    sid: payload.sessionId,
    uid: payload.userId,
    v: ACCESS_TOKEN_VERSION,
  } satisfies AccessTokenPayload)
  const encodedPayload = encodeBase64Url(serializedPayload)
  const signature = createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url')

  return `${encodedPayload}.${signature}`
}

export function verifyAccessToken(token: string, secret: string) {
  const [encodedPayload, providedSignature] = token.split('.')

  if (!encodedPayload || !providedSignature) {
    return null
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url')

  if (!safeCompare(providedSignature, expectedSignature)) {
    return null
  }

  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as Partial<AccessTokenPayload>

    if (
      payload.v !== ACCESS_TOKEN_VERSION ||
      typeof payload.uid !== 'number' ||
      typeof payload.sid !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      return null
    }

    if (payload.exp * 1000 <= Date.now()) {
      return null
    }

    return {
      expiresAt: new Date(payload.exp * 1000),
      sessionId: payload.sid,
      userId: payload.uid,
    }
  } catch {
    return null
  }
}

export function parseCookies(cookieHeader: string | undefined) {
  if (!cookieHeader) {
    return {}
  }

  return cookieHeader.split(';').reduce<Record<string, string>>((cookies, cookiePart) => {
    const separatorIndex = cookiePart.indexOf('=')

    if (separatorIndex === -1) {
      return cookies
    }

    const key = cookiePart.slice(0, separatorIndex).trim()
    const value = cookiePart.slice(separatorIndex + 1).trim()

    if (!key) {
      return cookies
    }

    cookies[key] = decodeURIComponent(value)
    return cookies
  }, {})
}

export function serializeCookie(
  name: string,
  value: string,
  options: {
    expires?: Date
    httpOnly?: boolean
    maxAgeSeconds?: number
    path?: string
    sameSite?: 'lax' | 'strict' | 'none'
    secure?: boolean
  } = {},
) {
  const parts = [`${name}=${encodeURIComponent(value)}`]

  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${options.maxAgeSeconds}`)
  }

  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`)
  }

  parts.push(`Path=${options.path ?? '/'}`)

  if (options.httpOnly) {
    parts.push('HttpOnly')
  }

  if (options.sameSite) {
    const normalizedSameSite =
      options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)
    parts.push(`SameSite=${normalizedSameSite}`)
  }

  if (options.secure) {
    parts.push('Secure')
  }

  return parts.join('; ')
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const derivedKey = (await scryptAsync(
    password,
    salt,
    SCRYPT_KEY_LENGTH,
  )) as Buffer

  return `${SCRYPT_PREFIX}$${salt}$${Buffer.from(derivedKey).toString('hex')}`
}

export async function verifyPassword(password: string, storedHash: string) {
  if (!storedHash.startsWith(`${SCRYPT_PREFIX}$`)) {
    return safeCompare(password, storedHash)
  }

  const [, salt, hash] = storedHash.split('$')

  if (!salt || !hash) {
    return false
  }

  const derivedKey = (await scryptAsync(
    password,
    salt,
    SCRYPT_KEY_LENGTH,
  )) as Buffer

  return safeCompare(Buffer.from(derivedKey).toString('hex'), hash)
}
