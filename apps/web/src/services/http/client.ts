import { webApiConfig } from '../../config/api'
import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from '../auth/session'
import { HttpClientError } from './errors'

interface RequestOptions extends RequestInit {
  query?: Record<string, string | number | boolean | undefined>
  retryOnUnauthorized?: boolean
  skipAuth?: boolean
}

const API_BASE_URL = webApiConfig.apiBaseUrl
let refreshPromise: Promise<string | null> | null = null

function withQuery(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
) {
  if (!query) {
    return `${API_BASE_URL}${path}`
  }

  const search = new URLSearchParams()

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      search.set(key, String(value))
    }
  })

  const searchText = search.toString()

  return searchText
    ? `${API_BASE_URL}${path}?${searchText}`
    : `${API_BASE_URL}${path}`
}

export async function request<T>(path: string, options: RequestOptions = {}) {
  const {
    query,
    headers,
    retryOnUnauthorized = true,
    skipAuth = false,
    ...init
  } = options
  const token = skipAuth ? null : getAccessToken()

  const response = await fetch(withQuery(path, query), {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  })

  if (response.status === 401 && !skipAuth && retryOnUnauthorized) {
    const nextAccessToken = await refreshAccessToken()

    if (nextAccessToken) {
      return request<T>(path, {
        ...options,
        headers,
        retryOnUnauthorized: false,
      })
    }
  }

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as
      | { message?: string }
      | null

    throw new HttpClientError(
      errorPayload?.message ?? `Request failed with status ${response.status}`,
      response.status,
    )
  }

  if (response.status === 204) {
    return undefined as T
  }

  const contentType = response.headers.get('Content-Type') ?? ''

  if (!contentType.includes('application/json')) {
    return undefined as T
  }

  return (await response.json()) as T
}

export async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await fetch(withQuery('/auth/refresh'), {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })

      if (!response.ok) {
        clearAccessToken()
        return null
      }

      const payload = (await response.json()) as {
        accessToken: string
      }

      setAccessToken(payload.accessToken)
      return payload.accessToken
    })().finally(() => {
      refreshPromise = null
    })
  }

  return refreshPromise
}
