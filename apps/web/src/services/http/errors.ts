export class HttpClientError extends Error {
  statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'HttpClientError'
    this.statusCode = statusCode
  }
}

export function isHttpClientError(error: unknown): error is HttpClientError {
  return error instanceof HttpClientError
}
