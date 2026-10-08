# Database Schema Shared Context

This file is intended to act as shared project memory for future Codex sessions in this workspace.
It documents the seven-table MySQL schema used by the upgraded online multiplayer document editing project.

## Overview

The current backend is designed around these seven tables:

1. `users`
2. `documents`
3. `document_members`
4. `document_revisions`
5. `sessions`
6. `audit_logs`
7. `document_collab_states`

They support these core features:

- account registration and login
- backend session validation
- document ownership
- document-level permissions (`admin`, `editor`, `viewer`)
- document revision history
- realtime collaborative editing persistence
- audit trails for sensitive actions

## Table-by-Table Details

### 1. `users`

Purpose:
- Stores account identity and login-related data.

Main fields:
- `id`: primary key
- `username`: unique login name
- `display_name`: user-facing name shown in UI
- `email`: unique email
- `password_hash`: stored password hash
- `system_role`: global platform role, currently `user` or `super_admin`
- `status`: account state, currently `active` or `disabled`
- `created_at`
- `updated_at`

How it is used:
- login finds a row by `username` or `email`
- password verification reads `password_hash`
- UI displays `display_name`
- `system_role = super_admin` can be treated as globally elevated access

Notes:
- This is global user identity, not per-document permission.
- Per-document permission lives in `document_members`.

### 2. `documents`

Purpose:
- Stores the main document entity.

Main fields:
- `id`: document id, currently string-based
- `title`: document title
- `content`: HTML document body
- `excerpt`: text summary for list display
- `owner_id`: references `users.id`
- `visibility`: `private` or `shared`
- `created_at`
- `updated_at`
- `deleted_at`: soft delete marker

How it is used:
- document list reads `title`, `excerpt`, `owner_id`, `updated_at`
- editor detail page reads full `content`
- save updates `title`, `content`, `excerpt`, `visibility`
- delete currently uses soft delete by setting `deleted_at`

Notes:
- Owner is the top-level creator/controller of the document.
- Owner should also appear as an `admin` member in `document_members`.

### 3. `document_members`

Purpose:
- Stores document-level access control.

Main fields:
- `id`: primary key
- `document_id`: references `documents.id`
- `user_id`: references `users.id`
- `role`: `admin`, `editor`, or `viewer`
- `created_at`

Role meanings:
- `admin`: can view, edit, delete, and manage members
- `editor`: can view and edit
- `viewer`: can only view

How it is used:
- backend checks this table before document read/write/member actions
- frontend receives the resolved role and permissions from backend responses
- member management UI updates rows in this table

Important design rule:
- This table is the core of permission management.
- `audit_logs` does not control permission; it only records actions.

### 4. `document_revisions`

Purpose:
- Stores revision history snapshots for documents.

Main fields:
- `id`: primary key
- `document_id`: references `documents.id`
- `version_number`: per-document version sequence
- `title_snapshot`
- `content_snapshot`
- `excerpt_snapshot`
- `edited_by`: references `users.id`, nullable
- `created_at`

How it is used:
- each save can append a new version row
- revision panel reads recent history from this table
- future rollback/history features can restore from these snapshots

Notes:
- This is intentionally snapshot-based, which is simpler than storing diffs.
- Good fit for a portfolio project because it is easy to explain and demo.

### 5. `sessions`

Purpose:
- Stores backend refresh-token sessions for authenticated users.

Main fields:
- `id`: primary key
- `user_id`: references `users.id`
- `token_hash`: hashed refresh token
- `user_agent`
- `ip_address`
- `expires_at`
- `revoked_at`
- `created_at`

How it is used:
- login/register create a refresh token and store only its hash here
- backend issues a short-lived access token separately
- refresh requests look up the refresh token hash in this table
- logout and token rotation revoke the current refresh session here

Notes:
- Frontend now stores only the short-lived access token locally.
- Refresh token is stored in an `httpOnly` cookie, not in frontend JavaScript storage.
- Backend still never trusts frontend role claims; it resolves the current user against the current session.

### 6. `audit_logs`

Purpose:
- Stores action history for sensitive operations.

Main fields:
- `id`: primary key
- `user_id`: references `users.id`, nullable
- `document_id`: references `documents.id`, nullable
- `action`: action name
- `metadata`: JSON payload for extra context
- `created_at`

Typical actions:
- `document_created`
- `document_updated`
- `document_deleted`
- `member_upserted`
- `member_role_updated`
- `member_removed`

How it is used:
- records who did what and when
- useful for debugging and later admin/reporting views

Important note:
- This table is not the permission source.
- It is an audit trail only.

### 7. `document_collab_states`

Purpose:
- Stores the persisted Yjs collaborative state for each document.

Main fields:
- `document_id`: primary key, also references `documents.id`
- `yjs_state`: binary Yjs document state (`LONGBLOB`)
- `updated_at`

How it is used:
- the collaboration server loads this table first when a user opens a collaborative document
- if a row exists, the realtime editor restores from this Yjs state instead of rebuilding from HTML
- when collaborative edits are persisted, backend writes the latest Yjs state back here
- the collaboration server also mirrors the latest rendered HTML back into `documents.content`

Notes:
- This table is for realtime editing state, not human-readable revision history.
- It works together with `documents`:
  - `document_collab_states` is the CRDT/source-of-truth state for live collaboration
  - `documents.content` remains the HTML snapshot used by the main app and fallback loading
- This table is created automatically by the collab service startup schema check.

## Relationship Summary

### `users` -> `documents`
- one user can own many documents
- `documents.owner_id` points to `users.id`

### `users` -> `document_members`
- one user can participate in many documents
- permission role is stored here

### `documents` -> `document_members`
- one document can have many members
- each member row defines one user's role in that document

### `documents` -> `document_revisions`
- one document can have many revisions

### `documents` -> `document_collab_states`
- one document has at most one persisted collaborative state row
- this row stores the latest Yjs state for realtime editing

### `users` -> `sessions`
- one user can have many active or historical sessions

### `users` / `documents` -> `audit_logs`
- one action log may point to a user, a document, or both

## Current Permission Resolution Model

When backend receives a document request, the intended permission logic is:

1. Verify the access token signature and expiration
2. Resolve the linked refresh session from `sessions`
3. Resolve current user from `users`
4. Resolve target document from `documents`
5. Resolve membership from `document_members`
6. Compute allowed actions

Typical result:
- owner or `super_admin` behaves like `admin`
- `admin`: can delete/edit/manage members
- `editor`: can edit but not delete/manage members
- `viewer`: read-only

## Which Table Does What

If a future session needs a quick reminder:

- login identity: `users`
- document main data: `documents`
- document permission: `document_members`
- version history: `document_revisions`
- realtime collaboration state: `document_collab_states`
- session validation: `sessions`
- short-lived bearer token: signed access token in backend auth logic
- action record: `audit_logs`

## Important Project Convention

For this project:

- permission management is document-level, not only global
- frontend may display role-based UI, but backend must always enforce the real rule
- soft deletion is handled through `documents.deleted_at`
- revision history is snapshot-based
- realtime collaboration persistence is stored in `document_collab_states`
- audit records should be written for sensitive changes

## Suggested Questions for Future Sessions

If a future session needs to extend this project, likely next questions are:

- how to seed real password hashes instead of placeholder passwords
- how to expose member management in the frontend more cleanly
- how to add document rollback from `document_revisions`
- how to harden collaborative loading/persistence around `document_collab_states`
- how to add comment tables or collaborative cursors later
