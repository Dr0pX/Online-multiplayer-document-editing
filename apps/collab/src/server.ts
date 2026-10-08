import type {
  Connection,
  onAuthenticatePayload,
  onRequestPayload,
  onTokenSyncPayload,
} from '@hocuspocus/server'
import { Server } from '@hocuspocus/server'
import { ensureTiptapDomEnvironment } from '@omde/shared'
import { collabConfig } from './config/index.js'
import { ensureCollaborationSchema } from './lib/database.js'
import {
  findDocumentAccess,
  findUserBySession,
  loadOrCreateCollabDocument,
  persistCollabDocument,
  type DocumentAccessContext,
} from './repositories/documents.js'
import { verifyAccessToken } from './utils/auth.js'

ensureTiptapDomEnvironment()

function parseDocumentId(documentName: string) {
  return documentName.trim()
}

async function authenticateConnection(
  payload:
    | onAuthenticatePayload<DocumentAccessContext>
    | onTokenSyncPayload<DocumentAccessContext>,
) {
  const verifiedToken = verifyAccessToken(
    payload.token,
    collabConfig.auth.accessTokenSecret,
  )

  if (!verifiedToken) {
    throw new Error('Collaboration token is invalid or expired.')
  }

  const user = await findUserBySession(verifiedToken.sessionId, verifiedToken.userId)

  if (!user) {
    throw new Error('Current login session is no longer valid.')
  }

  const documentId = parseDocumentId(payload.documentName)
  const access = await findDocumentAccess(user, documentId)

  if (!access?.canView) {
    throw new Error('You do not have permission to access this collaborative document.')
  }

  payload.connectionConfig.readOnly = !access.canEdit

  return access
}

async function refreshConnectionAccess(
  payload: onTokenSyncPayload<DocumentAccessContext>,
) {
  const access = await authenticateConnection(payload)

  payload.connection.readOnly = !access.canEdit
  payload.connection.context = access
}

function requestLiveTokenRefresh(connection: Connection<DocumentAccessContext>) {
  connection.requestToken()
}

function isAuthorizedControlRequest(request: onRequestPayload['request']) {
  return (
    request.headers['x-collab-control-secret'] === collabConfig.control.secret
  )
}

function sendJson(
  response: onRequestPayload['response'],
  statusCode: number,
  payload: Record<string, unknown>,
) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
  })
  response.end(JSON.stringify(payload))
}

function handleControlRequest({ request, response }: onRequestPayload) {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
  const match = /^\/internal\/documents\/([^/]+)\/reconnect$/.exec(requestUrl.pathname)

  if (!match) {
    return false
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, { message: 'Method not allowed.' })
    throw null
  }

  if (!isAuthorizedControlRequest(request)) {
    sendJson(response, 401, { message: 'Unauthorized collab control request.' })
    throw null
  }

  const documentId = decodeURIComponent(match[1] ?? '').trim()

  if (!documentId) {
    sendJson(response, 400, { message: 'Document id is required.' })
    throw null
  }

  server.hocuspocus.closeConnections(documentId)
  sendJson(response, 202, {
    documentId,
    status: 'reconnect_requested',
  })
  throw null
}

const server = new Server<DocumentAccessContext>({
  debounce: collabConfig.collaboration.storeDebounceMs,
  maxDebounce: collabConfig.collaboration.maxDebounceMs,
  name: 'online-multiplayer-document-editing-collab',
  port: collabConfig.server.port,
  async onAuthenticate(payload) {
    return authenticateConnection(payload)
  },
  async onTokenSync(payload) {
    await refreshConnectionAccess(payload)
  },
  async onLoadDocument({ documentName }) {
    return loadOrCreateCollabDocument(parseDocumentId(documentName))
  },
  async onRequest(payload) {
    handleControlRequest(payload)
  },
  async onStoreDocument({ documentName, document }) {
    await persistCollabDocument(parseDocumentId(documentName), document)
  },
})

async function main() {
  await ensureCollaborationSchema()
  await server.listen()

  const permissionRevalidationTimer = setInterval(() => {
    server.hocuspocus.documents.forEach((document) => {
      document.getConnections().forEach((connection) => {
        requestLiveTokenRefresh(connection)
      })
    })
  }, collabConfig.collaboration.permissionRevalidationIntervalMs)

  permissionRevalidationTimer.unref()
  console.log(`Collaboration server listening on port ${collabConfig.server.port}`)
}

void main()
