import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

async function main() {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  const uri = replica.getUri()
  const database = 'gptinder_local'
  const secret = randomBytes(32).toString('hex')
  writeFileSync(
    '.env.mock.local',
    `MONGODB_URI=${uri}\nMONGODB_DB=${database}\nAUTH_SECRET=${secret}\nAPP_URL=http://localhost:3000\n`,
    'utf8',
  )
  console.log(`Mock MongoDB is running for ${database}.`)
  console.log('Connection details were written to .env.mock.local.')
  console.log(
    'Leave this window open. Press Ctrl+C to stop and discard the database.',
  )

  const shutdown = async () => {
    await replica.stop()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  await new Promise(() => undefined)
}
void main()
