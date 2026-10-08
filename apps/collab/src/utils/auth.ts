import { createHmac, timingSafeEqual } from 'node:crypto'

interface AccessTokenPayload {
  exp: number
  sid: number
  uid: number
  v: number
}

const ACCESS_TOKEN_VERSION = 1

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
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
