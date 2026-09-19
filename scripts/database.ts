import { loadEnvConfig } from '@next/env'
import { randomUUID } from 'node:crypto'
import {
  collections,
  ensureIndexes,
  closeClient,
  transaction,
} from '../lib/server/db'
import { hashSecret, newSecret } from '../lib/server/auth'
import { DEMO_PEOPLE, DEMO_PREFERENCES } from '../lib/demo-fixtures'
import { DEFAULT_STYLE } from '../lib/import-domain'

loadEnvConfig(process.cwd())
async function main() {
  const command = process.argv[2]
  if (!['indexes', 'check', 'seed'].includes(command))
    throw new Error('Usage: database.ts indexes|check|seed')
  await ensureIndexes()
  const c = await collections()
  if (command === 'check') {
    const id = randomUUID()
    await c.checks.insertOne({ _id: id, createdAt: new Date() })
    if (!(await c.checks.findOne({ _id: id })))
      throw new Error('Write/read verification failed')
    await transaction(async (session) => {
      await c.checks.updateOne(
        { _id: id },
        { $set: { createdAt: new Date() } },
        { session },
      )
    })
    console.log(
      'Connection, indexes, write/read and replica-set transaction verified. The check record expires automatically.',
    )
  }
  if (command === 'seed') {
    for (const person of DEMO_PEOPLE) {
      const accessKey = newSecret()
      const created = await transaction(async (session) => {
        if (await c.users.findOne({ _id: person.id }, { session })) return false
        const profileVersionId = randomUUID()
        const preferenceVersionId = randomUUID()
        const now = new Date()
        await c.users.insertOne(
          {
            _id: person.id,
            displayName: person.name,
            accessKeyHash: hashSecret(accessKey),
            createdAt: now,
            profileVersionId,
            preferenceVersionId,
            demo: true,
          },
          { session },
        )
        const styleVersionId = randomUUID()
        await c.styles.insertOne(
          {
            _id: styleVersionId,
            userId: person.id,
            version: 1,
            settings: DEFAULT_STYLE,
            sourceIds: [],
            sampleIds: [],
            createdAt: now,
          },
          { session },
        )
        await c.profiles.insertOne(
          {
            _id: profileVersionId,
            userId: person.id,
            version: 1,
            shareable: person.profile,
            surveyScores: {},
            approvedAt: now,
            avatarSeed: person.name,
            styleVersionId,
            approvedEvidenceIds: [],
            sourceIds: [],
          },
          { session },
        )
        await c.preferences.insertOne(
          {
            _id: preferenceVersionId,
            userId: person.id,
            version: 1,
            dimensions: DEMO_PREFERENCES,
            createdAt: now,
          },
          { session },
        )
        await c.consents.insertOne(
          {
            _id: randomUUID(),
            userId: person.id,
            flags: {
              adult: true,
              survey: true,
              aiProcessing: true,
              sharedProfile: true,
              importedInformation: false,
            },
            createdAt: now,
          },
          { session },
        )
        return true
      })
      // Intentional one-time operator output. These credentials are never committed.
      console.log(
        created
          ? `${person.name} private sign-in key: ${accessKey}`
          : `${person.name}: already exists; existing versions and key preserved.`,
      )
    }
    console.log(
      'Demo fixtures are fictional reviewed profiles, not completed TIPI assessments. Sign into each account and download its own badge app.',
    )
  }
  if (command === 'indexes') console.log('Database indexes are ready.')
}
main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Database command failed',
    )
    process.exitCode = 1
  })
  .finally(closeClient)
