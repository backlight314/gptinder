import 'server-only'
import { z } from 'zod'
import { AppError } from './errors'
import { checkOrigin } from './auth'

export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes = 32768,
): Promise<T> {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new AppError(415, 'Expected JSON.')
  const reader = request.body?.getReader()
  if (!reader) throw new AppError(400, 'Request body is required.')
  const decoder = new TextDecoder()
  let body = ''
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new AppError(413, 'Request is too large.')
      }
      body += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return schema.parse(JSON.parse(body + decoder.decode()))
  } catch {
    throw new AppError(
      400,
      'Invalid request. Check the required fields and ranges.',
    )
  }
}
export function route(
  handler: (request: Request) => Promise<unknown>,
  mutation = false,
) {
  return async (request: Request) => {
    try {
      if (mutation) checkOrigin(request)
      const data = await handler(request)
      return Response.json(data, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500
      // Do not log model inputs, tokens, credentials or raw database errors.
      if (status === 500)
        console.error('Request failed', {
          kind: error instanceof Error ? error.name : 'unknown',
        })
      return Response.json(
        {
          error:
            error instanceof AppError
              ? error.message
              : 'The service could not complete this request. Please retry.',
        },
        {
          status,
          headers: {
            'Cache-Control': 'no-store',
            ...(status === 429 ? { 'Retry-After': '60' } : {}),
          },
        },
      )
    }
  }
}
