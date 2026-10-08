# Dual Token Auth Upgrade

This project now uses a dual-token authentication model:

1. `accessToken`
2. `refreshToken`

## What Changed

- `accessToken`
  - short-lived
  - returned in JSON from `/api/auth/login`, `/api/auth/register`, and `/api/auth/refresh`
  - stored by the frontend in localStorage
  - sent as `Authorization: Bearer ...`

- `refreshToken`
  - long-lived
  - stored only in an `httpOnly` cookie
  - never exposed to frontend JavaScript
  - persisted in the `sessions` table as a hash

## Backend Flow

- login/register
  - create refresh session in `sessions`
  - issue signed access token
  - set refresh cookie

- authenticated business requests
  - verify access token signature
  - verify the linked refresh session is still active
  - resolve the current user

- refresh
  - read refresh cookie
  - find the hashed refresh token in `sessions`
  - revoke the old session
  - create a new refresh session
  - issue a new access token
  - set a new refresh cookie

- logout
  - revoke the refresh session if present
  - clear the refresh cookie

## Frontend Flow

- frontend stores only `accessToken`
- every request includes `credentials: 'include'`
- if a request gets `401`, the client automatically calls `/api/auth/refresh`
- if refresh succeeds, the client retries the original request once
- if refresh fails, local access token storage is cleared

## Current Config You Must Replace

File:
- `apps/api/src/config/index.ts`

Important placeholder:
- `auth.accessTokenSecret`

Replace it with a long random secret before using this in a real environment.

## Database Impact

This upgrade does not require a mandatory schema change if your existing `sessions` table already has:

- `id`
- `user_id`
- `token_hash`
- `user_agent`
- `ip_address`
- `expires_at`
- `revoked_at`
- `created_at`

## Recommended Future Enhancements

- add `last_used_at` to `sessions`
- add `replaced_by_session_id` to trace refresh rotation chains
- add `logout_all` endpoint
- move access-token storage from localStorage to in-memory plus restore-on-refresh if you want even stronger XSS resistance
