import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { ensureIndexes, closeClient } from '../lib/server/db'

async function main() {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  const env = {
    ...process.env,
    MONGODB_URI: replica.getUri(),
    MONGODB_DB: 'gptinder_local',
    AUTH_SECRET: randomBytes(32).toString('hex'),
    APP_URL: 'http://localhost:3000',
    ALLOW_DEMO_AUTH: 'true',
  }
  process.env.MONGODB_URI = env.MONGODB_URI
  process.env.MONGODB_DB = env.MONGODB_DB
  process.env.AUTH_SECRET = env.AUTH_SECRET
  process.env.APP_URL = env.APP_URL
  await ensureIndexes()
  console.log('Starting GPTinder with a temporary replica-set MongoDB.')
  console.log('Open http://localhost:3000 after Next.js reports it is ready.')
  console.log('Press Ctrl+C to stop both the app and the database.')
  const next = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'dev'],
    {
      env,
      stdio: 'inherit',
      windowsHide: false,
    },
  )
  const shutdown = async () => {
    next.kill()
    await closeClient()
    await replica.stop()
    process.exit(next.exitCode ?? 0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  next.once('exit', async (code) => {
    await closeClient()
    await replica.stop()
    process.exit(code ?? 0)
  })
}
void main()
