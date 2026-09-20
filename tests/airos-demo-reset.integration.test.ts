// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { GET as getPhoto } from '@/app/api/airos/profiles/[badgeId]/photo/route'
import { resetAirosDemoData } from '@/lib/airos-demo-reset'
import { getPublicProfile, listPublicProfiles } from '@/lib/airos-directory-store'
import { getMongoDatabase } from '@/lib/mongodb'
import { enforceAirosRateLimit } from '@/lib/airos-api'

let mongo: MongoMemoryServer
let database: Awaited<ReturnType<typeof getMongoDatabase>>

const badgeId = 'photo-test-badge-star'
const userId = 'usr_airos_photo_test'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs2sAAAAASUVORK5CYII=', 'base64')

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongo.getUri()
  process.env.MONGODB_DB = 'isolated_airos_photo_tests'
  global.__airosMongoClientPromise = undefined
  global.__airosMongoIndexesPromise = undefined
  database = await getMongoDatabase()
  const now = new Date()
  await database.collection('airos_profiles').insertOne({
    badgeId,
    userId,
    name: 'Photo Person',
    linkedin: 'https://www.linkedin.com/in/photo-person',
    source: 'badge_import',
    importedFromBadgeIds: [badgeId],
    observationCount: 1,
    firstImportedAt: now,
    lastImportedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  await database.collection('linkedin_profiles').insertOne({
    userId,
    cachedAvatar: { contentType: 'image/png', data: png.toString('base64'), cachedAt: now },
  })
  await database.collection('discord_messages').insertOne({ userId, text: 'badge discord sample' })
  await database.collection('whatsapp_messages').insertOne({ userId, text: 'badge whatsapp sample' })
})

afterAll(async () => {
  await (await global.__airosMongoClientPromise)?.close()
  global.__airosMongoClientPromise = undefined
  global.__airosMongoIndexesPromise = undefined
  await mongo.stop()
})

describe('AIROS profile photo and demo reset', () => {
  it('allows localhost writes under a production build while public hosts still require a configured salt', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AIROS_RATE_LIMIT_SALT', '')
    await expect(enforceAirosRateLimit(new Request('https://hacktheheart.vercel.app/api/airos/imports/preview'), 'preview'))
      .rejects.toMatchObject({ message: 'Anonymous write rate limiting is not configured.', status: 503 })
    await expect(enforceAirosRateLimit(new Request('http://localhost:3002/api/airos/imports/preview'), 'preview')).resolves.toBeUndefined()
    await expect(enforceAirosRateLimit(new Request('http://localhost:3002/api/airos/imports'), 'import')).resolves.toBeUndefined()
    expect(await database.collection('airos_rate_limits').countDocuments()).toBe(0)
    vi.unstubAllEnvs()
  })

  it('serves a stable cached social photo through the local profile endpoint', async () => {
    const profile = await getPublicProfile(badgeId)
    expect(profile?.avatarUrl).toBe(`/api/airos/profiles/${badgeId}/photo`)
    expect(profile?.messagingConnections).toEqual({ discord: true, whatsapp: true })
    const directory = await listPublicProfiles('', 1)
    expect(directory.profiles[0]?.avatarUrl).toBe(`/api/airos/profiles/${badgeId}/photo`)
    const response = await getPhoto(new Request(`http://localhost/api/airos/profiles/${badgeId}/photo`), {
      params: Promise.resolve({ badgeId }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png)
  })

  it('clears badge data while preserving cached social profile photos', async () => {
    await database.collection('airos_connections').insertOne({ badgeIds: [badgeId, 'friend'] })
    await database.collection('airos_profile_observations').insertOne({ badgeId })
    await database.collection('airos_imports').insertOne({ ownerBadgeId: badgeId })
    await database.collection('airos_profile_analyses').insertOne({ badgeId })
    await database.collection('airos_rate_limits').insertOne({ kind: 'import' })
    await database.collection('social_posts').insertMany([{ userId, platform: 'linkedin', externalId: 'badge-post' }, { userId: 'unrelated', platform: 'linkedin', externalId: 'other-post' }])
    await database.collection('social_comments').insertMany([{ userId, platform: 'linkedin', externalId: 'badge-comment' }, { userId: 'unrelated', platform: 'linkedin', externalId: 'other-comment' }])
    await database.collection<{ _id: string }>('users').insertMany([{ _id: userId }, { _id: 'unrelated' }])
    await database.collection('discord_messages').insertOne({ userId: 'unrelated', text: 'keep discord sample' })
    await database.collection('whatsapp_messages').insertOne({ userId: 'unrelated', text: 'keep whatsapp sample' })

    const result = await resetAirosDemoData()
    expect(result.profileUserCount).toBe(1)
    for (const collection of ['airos_profiles', 'airos_connections', 'airos_profile_observations', 'airos_imports', 'airos_profile_analyses', 'airos_rate_limits']) {
      expect(await database.collection(collection).countDocuments()).toBe(0)
    }
    expect(await database.collection('linkedin_profiles').countDocuments({ userId })).toBe(1)
    expect(await database.collection('social_posts').countDocuments({ userId: 'unrelated' })).toBe(1)
    expect(await database.collection('social_comments').countDocuments({ userId: 'unrelated' })).toBe(1)
    expect(await database.collection<{ _id: string }>('users').countDocuments({ _id: 'unrelated' })).toBe(1)
    expect(await database.collection('discord_messages').countDocuments({ userId: 'unrelated' })).toBe(1)
    expect(await database.collection('whatsapp_messages').countDocuments({ userId: 'unrelated' })).toBe(1)
  })
})
