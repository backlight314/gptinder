import { MongoClient } from 'mongodb'

const mongoUri = process.env.MONGODB_URI
const databaseName = process.env.MONGODB_DB || 'gptinder'

if (!mongoUri) throw new Error('MONGODB_URI is not configured')

const minimalPrompt = `## Identity and personality
Not disclosed. Do not infer traits that are not supported by account evidence.

## Preferences, values, goals, and boundaries
Not disclosed. Ask naturally rather than assuming preferences or boundaries.

## Approved knowledge and interests
Not known. Do not present unknown information as personal experience.

## Texting style
Use a restrained, natural neutral style. Do not invent a distinctive voice.`

const sources = [
  'persona', 'profiles', 'profileSections', 'posts', 'authoredComments',
  'discordMessages', 'whatsappMessages', 'textSamples', 'knowledgeDocuments', 'adaptations',
]

const client = new MongoClient(mongoUri, { appName: 'gptinder-agent-context-migration' })
await client.connect()

try {
  const database = client.db(databaseName)
  const users = await database.collection('users').find({}, { projection: { _id: 1 } }).toArray()
  const now = new Date()
  const result = users.length
    ? await database.collection('agent_contexts').bulkWrite(users.map((user) => ({
      updateOne: {
        filter: { userId: String(user._id) },
        update: {
          $setOnInsert: {
            userId: String(user._id),
            revision: 0,
            compiledPrompt: minimalPrompt,
            sourceEvidenceIds: [],
            sourceDigests: Object.fromEntries(sources.map((source) => [source, ''])),
            sourceStats: sources.map((source) => ({ source, documentsRead: 0, documentsIncluded: 0, charactersIncluded: 0, truncated: false })),
            builtAt: now,
            updatedAt: now,
          },
        },
        upsert: true,
      },
    })))
    : { upsertedCount: 0, matchedCount: 0 }
  await database.collection('agent_contexts').createIndex({ userId: 1 }, { unique: true, name: 'agent_context_user_unique' })
  console.log(JSON.stringify({ users: users.length, contextsInserted: result.upsertedCount, contextsAlreadyPresent: result.matchedCount }))
} finally {
  await client.close()
}
