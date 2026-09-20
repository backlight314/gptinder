import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { MongoClient } from 'mongodb'

export function normalizeDiscordExport(userId, exported) {
  if (!userId) throw new Error('An application userId is required')
  if (exported?.source && exported.source !== 'discord') throw new Error(`Unsupported export source: ${exported.source}`)
  const messages = Array.isArray(exported?.messages) ? exported.messages : null
  if (!messages) throw new Error('The export has no messages array')
  const documents = new Map()
  for (const message of messages) {
    const text = typeof message?.content === 'string' ? message.content.trim() : ''
    const occurredAt = new Date(message?.timestamp ?? NaN)
    if (!text || Number.isNaN(occurredAt.getTime())) continue
    const externalId = message.message_id
      ? String(message.message_id)
      : createHash('sha256').update(`${occurredAt.toISOString()}|${text}`).digest('hex').slice(0, 24)
    documents.set(externalId, {
      _id: `${userId}:discord:${externalId}`,
      userId,
      source: 'discord',
      externalId,
      text: text.slice(0, 800),
      createdAt: occurredAt,
    })
  }
  return Array.from(documents.values())
}

async function main() {
  const [userId, exportPath] = process.argv.slice(2)
  if (!userId || !exportPath)
    throw new Error('Usage: node --env-file=.env.local scripts/import-discord-voice.mjs <userId> <export.json>')
  const mongoUri = process.env.MONGODB_URI
  if (!mongoUri) throw new Error('MONGODB_URI is not configured')

  const documents = normalizeDiscordExport(userId, JSON.parse(await readFile(exportPath, 'utf8')))
  if (!documents.length) throw new Error('The export contained no usable messages')

  const client = new MongoClient(mongoUri, { appName: 'gptinder-discord-voice-import' })
  await client.connect()
  try {
    const database = client.db(process.env.MONGODB_DB || 'gptinder')
    const messages = database.collection('discord_messages')
    const importedAt = new Date()
    const result = await messages.bulkWrite(
      documents.map(({ _id, ...document }) => ({
        updateOne: { filter: { _id }, update: { $set: { ...document, importedAt } }, upsert: true },
      })),
      { ordered: false },
    )
    await messages.createIndex({ userId: 1, createdAt: -1 }, { name: 'discord_user_messages_recent' })
    console.log(JSON.stringify({
      userId,
      read: documents.length,
      inserted: result.upsertedCount,
      updated: result.modifiedCount,
      stored: await messages.countDocuments({ userId }),
    }, null, 2))
  } finally {
    await client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) await main()
