export const collabConfig = {
  auth: {
    accessTokenSecret: 'replace-this-with-a-long-random-access-token-secret',
  },
  control: {
    secret: 'replace-this-with-a-long-random-collab-control-secret',
  },
  collaboration: {
    documentFieldName: 'default',
    maxDebounceMs: 5000,
    permissionRevalidationIntervalMs: 15000,
    storeDebounceMs: 1500,
  },
  database: {
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'online_multiplayer_document_editing',
    connectionLimit: 10,
  },
  server: {
    port: 3002,
  },
} as const
