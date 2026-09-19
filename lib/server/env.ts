import 'server-only'
import { z } from 'zod'

export function databaseEnv() {
  return z
    .object({
      MONGODB_URI: z.string().min(1),
      MONGODB_DB: z.string().regex(/^[A-Za-z0-9_-]+$/),
    })
    .parse(process.env)
}
export function authEnv() {
  return z
    .object({ AUTH_SECRET: z.string().min(32), APP_URL: z.url() })
    .parse(process.env)
}
export function aiEnv() {
  return z
    .object({
      OPENAI_API_KEY: z.string().min(1),
      OPENAI_MODEL: z.string().min(1),
    })
    .parse(process.env)
}
