import 'server-only'
import { MongoClient, type ClientSession } from 'mongodb'
import type {
  User,
  Consent,
  Interview,
  Evidence,
  ProfileVersion,
  PreferenceVersion,
  BadgeBinding,
  Encounter,
  SimulationMessage,
  MatchResult,
  DateFeedback,
  PreferenceUpdate,
} from '../domain'
import { databaseEnv } from './env'
import type {
  ImportSource,
  ImportedClaim,
  StyleVersion,
  RetrievalRecord,
  PreviewRecord,
  StoredWritingSample,
} from '../import-domain'

let clientPromise: Promise<MongoClient> | undefined
export function getClient() {
  if (!clientPromise) {
    const client = new MongoClient(databaseEnv().MONGODB_URI, {
      maxPoolSize: 5,
      minPoolSize: 0,
      maxIdleTimeMS: 60000,
      serverSelectionTimeoutMS: 8000,
      waitQueueTimeoutMS: 5000,
    })
    clientPromise = client.connect().catch((error) => {
      clientPromise = undefined
      throw error
    })
  }
  return clientPromise
}
/** CLI/test shutdown only. Request handlers reuse the shared pool. */
export async function closeClient() {
  const pending = clientPromise
  clientPromise = undefined
  if (pending)
    await pending.then((client) => client.close()).catch(() => undefined)
}
export async function collections() {
  const db = (await getClient()).db(databaseEnv().MONGODB_DB)
  return {
    imports: db.collection<Omit<ImportSource, 'samples'>>('source_imports'),
    samples: db.collection<StoredWritingSample>('writing_samples'),
    claims: db.collection<ImportedClaim>('evidence'),
    styles: db.collection<StyleVersion>('style_profile_versions'),
    retrieval: db.collection<RetrievalRecord>('retrieval_records'),
    previews: db.collection<PreviewRecord>('persona_previews'),
    users: db.collection<User>('users'),
    loginTokens: db.collection<{
      _id: string
      email: string
      displayName: string
      expiresAt: Date
    }>('login_tokens'),
    consents: db.collection<Consent>('consents'),
    interviews: db.collection<Interview>('interviews'),
    evidence: db.collection<Evidence>('evidence'),
    profiles: db.collection<ProfileVersion>('profile_versions'),
    preferences: db.collection<PreferenceVersion>('preference_versions'),
    badges: db.collection<BadgeBinding>('badge_bindings'),
    encounters: db.collection<Encounter>('encounters'),
    messages: db.collection<SimulationMessage>('simulation_messages'),
    results: db.collection<MatchResult>('match_results'),
    feedback: db.collection<DateFeedback>('date_feedback'),
    updates: db.collection<PreferenceUpdate>('preference_updates'),
    limits: db.collection<{ _id: string; count: number; expiresAt: Date }>(
      'rate_limits',
    ),
    checks: db.collection<{ _id: string; createdAt: Date }>(
      'connectivity_checks',
    ),
  }
}
export async function transaction<T>(
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = (await getClient()).startSession()
  try {
    return await session.withTransaction(() => work(session), {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      maxCommitTimeMS: 10000,
    })
  } finally {
    await session.endSession()
  }
}
export async function ensureIndexes() {
  const c = await collections()
  await Promise.all([
    c.imports.createIndex({ userId: 1, createdAt: -1 }),
    c.imports.createIndex({ deletedAt: 1 }, { expireAfterSeconds: 30 * 86400 }),
    c.claims.createIndex({ userId: 1, sourceId: 1 }),
    c.samples.createIndex({ sourceId: 1, id: 1 }, { unique: true }),
    c.styles.createIndex({ userId: 1, version: 1 }, { unique: true }),
    c.retrieval.createIndex({ sourceId: 1, sampleId: 1 }, { unique: true }),
    c.previews.createIndex({ userId: 1, createdAt: -1 }),
    c.users.createIndex({ accessKeyHash: 1 }, { unique: true }),
    c.users.createIndex(
      { email: 1 },
      { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
    ),
    c.loginTokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    c.interviews.createIndex({ userId: 1 }, { unique: true }),
    c.consents.createIndex({ userId: 1, createdAt: -1 }),
    c.evidence.createIndex({ userId: 1 }),
    c.profiles.createIndex({ userId: 1, version: 1 }, { unique: true }),
    c.preferences.createIndex({ userId: 1, version: 1 }, { unique: true }),
    c.badges.createIndex({ tokenHash: 1 }, { unique: true }),
    c.badges.createIndex({ userId: 1, status: 1 }),
    c.encounters.createIndex({ handshakeKey: 1 }, { unique: true }),
    c.encounters.createIndex({ 'participants.userId': 1, createdAt: -1 }),
    c.encounters.createIndex({ status: 1, dispatchLeaseUntil: 1 }),
    c.messages.createIndex({ encounterId: 1, turnNumber: 1 }, { unique: true }),
    c.results.createIndex({ encounterId: 1 }, { unique: true }),
    c.feedback.createIndex({ encounterId: 1, authorId: 1 }, { unique: true }),
    c.updates.createIndex(
      { feedbackId: 1, feedbackRevision: 1 },
      { unique: true },
    ),
    c.limits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    c.checks.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 }),
  ])
}
