import { appConfig } from '../config/index.js'

export async function notifyCollabToReconnectDocument(documentId: string) {
  const response = await fetch(
    `${appConfig.collab.controlUrl}/${encodeURIComponent(documentId)}/reconnect`,
    {
      method: 'POST',
      headers: {
        'x-collab-control-secret': appConfig.collab.controlSecret,
      },
    },
  )

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(
      `Collab reconnect request failed with status ${response.status}${message ? `: ${message}` : '.'}`,
    )
  }
}
