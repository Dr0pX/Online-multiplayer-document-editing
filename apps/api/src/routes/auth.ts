import { Router, type Response } from 'express'
import { appConfig } from '../config/index.js'
import {
  createUser,
  createUserSession,
  findUserByLogin,
  findUserBySessionTokenHash,
  revokeUserSession,
  revokeUserSessionById,
} from '../repositories/auth.js'
import { getAuthenticatedRequest, requireAuth } from '../middleware/auth.js'
import {
  createAccessToken,
  createOpaqueToken,
  hashPassword,
  hashSessionToken,
  parseCookies,
  serializeCookie,
  verifyPassword,
} from '../utils/auth.js'
import { HttpError } from '../utils/http.js'
/*
 安全架构全景图

  ┌─────────────────────────────────────────────────────────────┐
  │                       客户端                                │
  │  localStorage: accessToken                                  │
  │  Cookie (httpOnly): refreshToken                            │
  └─────────────────────┬───────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            │                       │
      业务请求（Bearer）        刷新/登出（Cookie）
            │                       │
      ┌─────▼──────┐          ┌─────▼──────┐
      │ requireAuth│          │ /refresh   │
      │ 中间件     │          │ /logout    │
      └─────┬──────┘          └─────┬──────┘
            │                       │
      ┌─────▼───────────────────────▼──────┐
      │            sessions 表              │
      │  token_hash | expires_at | revoked │
      └────────────────────────────────────┘
            │
      ┌─────▼──────┐
      │   users 表  │
      │  status    │── active/disabled 实时检查
      └────────────┘

  纵深防御层次：
  1. 传输层：access token → HMAC 签名（防篡改） + 过期时间（防重放）
  2. 会话层：每个 access token 绑定一个 session → session 可被单独撤销
  3. 持久层：refresh token 只存哈希 → 数据库泄露不泄露有效 token
  4. 应用层：status = disabled → 即使 token/session 有效也拒绝访问
  5. Cookie 层：httpOnly + SameSite + Path → 多层限制 cookie 的传播范围

  ---
  这就是 routes/auth.ts 的完整逐行分析。它是整个认证系统的编排中心，负责协调密码学工具函数、数据库操作、cookie 管理，并实现了双令牌体系中的全部 5 个认证端点。
*/
export const authRouter = Router()

function createAccessTokenExpiryDate() {
  return new Date(
    Date.now() + 1000 * 60 * appConfig.auth.accessTokenDurationMinutes,
  )
}

function createRefreshTokenExpiryDate() {
  return new Date(
    Date.now() + 1000 * 60 * 60 * 24 * appConfig.auth.refreshTokenDurationDays,
  )
}

function setRefreshTokenCookie(response: Response, token: string, expiresAt: Date) {
  response.setHeader(
    'Set-Cookie',
    serializeCookie(appConfig.auth.refreshCookieName, token, {
      expires: expiresAt,
      httpOnly: true,
      path: appConfig.auth.refreshCookiePath,
      sameSite: appConfig.auth.sameSite,
      secure: appConfig.auth.secureCookie,
    }),
  )
}

function clearRefreshTokenCookie(response: Response) {
  response.setHeader(
    'Set-Cookie',
    serializeCookie(appConfig.auth.refreshCookieName, '', {
      expires: new Date(0),
      httpOnly: true,
      maxAgeSeconds: 0,
      path: appConfig.auth.refreshCookiePath,
      sameSite: appConfig.auth.sameSite,
      secure: appConfig.auth.secureCookie,
    }),
  )
}

function getRefreshTokenFromRequest(cookieHeader: string | undefined) {
  const cookies = parseCookies(cookieHeader)
  return cookies[appConfig.auth.refreshCookieName] ?? null
}

function createAuthResponse(user: { id: number }, sessionId: number) {
  const accessTokenExpiresAt = createAccessTokenExpiryDate()
  const accessToken = createAccessToken(
    {
      expiresAt: accessTokenExpiresAt,
      sessionId,
      userId: user.id,
    },
    appConfig.auth.accessTokenSecret,
  )

  return {
    accessToken,
    accessTokenExpiresAt,
  }
}

authRouter.post('/register', async (request, response, next) => {
  try {
    const payload = request.body as Partial<{
      displayName: string
      email: string
      password: string
      username: string
    }>

    if (
      typeof payload.username !== 'string' ||
      typeof payload.displayName !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.password !== 'string'
    ) {
      throw new HttpError(
        400,
        'Registration requires username, displayName, email, and password.',
      )
    }

    const username = payload.username.trim()
    const displayName = payload.displayName.trim()
    const email = payload.email.trim().toLowerCase()
    const password = payload.password

    if (!username || !displayName || !email || password.length < 6) {
      throw new HttpError(
        400,
        'Please provide non-empty username, display name, email, and a password with at least 6 characters.',
      )
    }

    const passwordHash = await hashPassword(password)
    const createdUser = await createUser({
      displayName,
      email,
      password,
      passwordHash,
      username,
    })

    if (!createdUser) {
      throw new HttpError(500, 'Failed to create the user account.')
    }

    const refreshToken = createOpaqueToken()
    const refreshTokenExpiresAt = createRefreshTokenExpiryDate()

    const sessionId = await createUserSession(
      createdUser.user.id,
      hashSessionToken(refreshToken),
      refreshTokenExpiresAt,
      request.headers['user-agent'] ?? null,
      request.ip ?? null,
    )
    const { accessToken, accessTokenExpiresAt } = createAuthResponse(
      createdUser.user,
      sessionId,
    )

    setRefreshTokenCookie(response, refreshToken, refreshTokenExpiresAt)

    response.status(201).json({
      accessToken,
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
      user: createdUser.user,
    })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/login', async (request, response, next) => {
  try {
    const payload = request.body as Partial<{
      login: string
      password: string
    }>

    if (typeof payload.login !== 'string' || typeof payload.password !== 'string') {
      throw new HttpError(400, 'Login requires "login" and "password".')
    }

    const account = await findUserByLogin(payload.login)

    if (!account) {
      throw new HttpError(401, 'Invalid username/email or password.')
    }

    if (account.user.status !== 'active') {
      throw new HttpError(403, 'This account is disabled.')
    }

    const isValidPassword = await verifyPassword(payload.password, account.passwordHash)

    if (!isValidPassword) {
      throw new HttpError(401, 'Invalid username/email or password.')
    }

    const refreshToken = createOpaqueToken()
    const refreshTokenExpiresAt = createRefreshTokenExpiryDate()

    const sessionId = await createUserSession(
      account.user.id,
      hashSessionToken(refreshToken),
      refreshTokenExpiresAt,
      request.headers['user-agent'] ?? null,
      request.ip ?? null,
    )
    const { accessToken, accessTokenExpiresAt } = createAuthResponse(
      account.user,
      sessionId,
    )

    setRefreshTokenCookie(response, refreshToken, refreshTokenExpiresAt)

    response.json({
      accessToken,
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
      user: account.user,
    })
  } catch (error) {
    next(error)
  }
})

authRouter.get('/me', requireAuth, (request, response) => {
  const authenticatedRequest = getAuthenticatedRequest(request)

  response.json({
    user: authenticatedRequest.authUser,
  })
})

authRouter.post('/refresh', async (request, response, next) => {
  try {
    const refreshToken = getRefreshTokenFromRequest(request.headers.cookie)

    if (!refreshToken) {
      clearRefreshTokenCookie(response)
      throw new HttpError(401, 'Refresh token is missing.')
    }

    const session = await findUserBySessionTokenHash(hashSessionToken(refreshToken))

    if (!session) {
      clearRefreshTokenCookie(response)
      throw new HttpError(401, 'Your refresh session is invalid or has expired.')
    }

    await revokeUserSessionById(session.id)

    const nextRefreshToken = createOpaqueToken()
    const nextRefreshTokenExpiresAt = createRefreshTokenExpiryDate()
    const nextSessionId = await createUserSession(
      session.user.id,
      hashSessionToken(nextRefreshToken),
      nextRefreshTokenExpiresAt,
      request.headers['user-agent'] ?? null,
      request.ip ?? null,
    )
    const { accessToken, accessTokenExpiresAt } = createAuthResponse(
      session.user,
      nextSessionId,
    )

    setRefreshTokenCookie(response, nextRefreshToken, nextRefreshTokenExpiresAt)

    response.json({
      accessToken,
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
      user: session.user,
    })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/logout', async (request, response, next) => {
  try {
    const refreshToken = getRefreshTokenFromRequest(request.headers.cookie)

    if (refreshToken) {
      await revokeUserSession(hashSessionToken(refreshToken))
    }

    clearRefreshTokenCookie(response)

    response.status(204).send()
  } catch (error) {
    next(error)
  }
})
