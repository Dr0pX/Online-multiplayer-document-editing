import type { NextFunction, Request, Response } from 'express'
import { appConfig } from '../config/index.js'
import { findUserBySessionId } from '../repositories/auth.js'
import type { AuthUser } from '../types/auth.js'
import { verifyAccessToken } from '../utils/auth.js'
import { HttpError } from '../utils/http.js'

interface AuthenticatedRequest extends Request {
  authSessionId: number
  authUser: AuthUser
}

function getBearerToken(request: Request) {
  const authorization = request.headers.authorization

  if (!authorization?.startsWith('Bearer ')) {
    return null
  }

  return authorization.slice('Bearer '.length).trim()
}

export async function requireAuth(
  request: Request,
  _response: Response,
  next: NextFunction,
) {
  try {
    const token = getBearerToken(request)

    if (!token) {
      throw new HttpError(401, 'Missing authorization token.')
    }

    const payload = verifyAccessToken(token, appConfig.auth.accessTokenSecret)

    if (!payload) {
      throw new HttpError(401, 'Your access token is invalid or has expired.')
    }

    const user = await findUserBySessionId(payload.sessionId, payload.userId)

    if (!user) {
      throw new HttpError(401, 'Your session is invalid or has expired.')
    }

    ;(request as AuthenticatedRequest).authSessionId = payload.sessionId
    ;(request as AuthenticatedRequest).authUser = user

    next()
  } catch (error) {
    next(error)
  }
}

export function getAuthenticatedRequest(request: Request) {
  return request as AuthenticatedRequest
}
