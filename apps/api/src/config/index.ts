export const appConfig = {
  auth: {
    accessTokenDurationMinutes: 15,
    accessTokenSecret: 'replace-this-with-a-long-random-access-token-secret',
    refreshCookieName: 'online_multiplayer_document_editing_refresh_token',
    refreshCookiePath: '/api/auth',
    refreshTokenDurationDays: 30,
    sameSite: 'lax',
    secureCookie: false,
  },
  collab: {
    controlSecret: 'replace-this-with-a-long-random-collab-control-secret',
    controlUrl: 'http://127.0.0.1:3002/internal/documents',
  },
  server: {
    port: 3001,
  },
  cors: {
    origin: 'http://localhost:5173',
  },
  database: {
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'online_multiplayer_document_editing',
    connectionLimit: 10,
  },
} as const
