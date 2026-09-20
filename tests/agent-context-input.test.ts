// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { getMongoDatabase } from '@/lib/mongodb'
import { loadRawAccountPromptInput, MAX_CHARS_PER_SOURCE, MAX_TOTAL_BUILDER_INPUT_CHARS } from '@/lib/agent-contexts/raw-input'
import { storeSocialImport } from '@/lib/social-store'

let mongo: MongoMemoryServer
let database: any
const userId = 'usr_prompt_input_owner'

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongo.getUri()
  process.env.MONGODB_DB = 'agent_context_input_tests'
  database = await getMongoDatabase()
  await database.collection('users').insertOne({ _id: userId, displayName: 'Alex', email: 'never-include@example.test' })
  await database.collection('personas').insertOne({ _id: 'persona:1', userId, name: 'Alex', bio: 'Enjoys gallery walks.', traits: ['curious'], interests: ['art'], style: 'lowercase and concise', values: ['kindness'] })
  await database.collection('linkedin_profiles').insertOne({ _id: 'profile:1', userId, platform: 'linkedin', headline: 'Designer', about: 'Public profile detail.', telephone: '555-0100' })
  await database.collection('social_profile_sections').insertOne({ _id: 'section:1', userId, platform: 'linkedin', heading: 'Experience', text: 'Makes accessible tools.' })
  await database.collection('social_posts').insertOne({ _id: 'post:1', userId, platform: 'x', kind: 'post', text: 'A'.repeat(2600) })
  await database.collection('social_comments').insertMany([
    { _id: 'comment:own', userId, authorUserId: userId, platform: 'x', externalId: 'own', text: 'My own comment.' },
    { _id: 'comment:other', userId, authorUserId: 'usr_someone_else', platform: 'x', externalId: 'other', text: 'Other person private comment.' },
  ])
  await database.collection('discord_messages').insertMany([
    { _id: 'discord:own', userId, authorUserId: userId, text: 'discord writing sample' },
    { _id: 'discord:other', userId, authorUserId: 'usr_someone_else', text: 'other discord message' },
  ])
  await database.collection('whatsapp_messages').insertOne({ _id: 'whatsapp:own', userId, text: 'whatsapp writing sample, call 416-555-0199' })
  await database.collection('user_text_samples').insertOne({ _id: 'sample:own', userId, text: 'direct writing sample' })
  await database.collection('approved_knowledge_documents').insertMany([
    { _id: 'knowledge:approved', userId, approved: true, title: 'Gardening', text: 'Grows herbs.' },
    { _id: 'knowledge:draft', userId, approved: false, title: 'Draft', text: 'Do not include.' },
  ])
  await database.collection('interpreter_adaptations').insertOne({ _id: 'adaptation:1', userId, guidance: 'Treat short replies as possibly busy, not certainly disinterested.', confidence: 'low' })
}, 60000)

afterAll(async () => {
  await (await global.__airosMongoClientPromise)?.close()
  global.__airosMongoClientPromise = undefined
  global.__airosMongoIndexesPromise = undefined
  await mongo?.stop()
})

describe('raw account prompt input', () => {
  it('collects each permitted owner-scoped source while excluding secrets and other authors', async () => {
    const input = await loadRawAccountPromptInput(userId, database)
    expect(input.rawMongoDocuments.persona.map(item => item.id)).toContain('personas:persona:1')
    expect(input.rawMongoDocuments.profiles.map(item => item.id)).toContain('linkedin_profiles:profile:1')
    expect(input.rawMongoDocuments.profileSections.map(item => item.id)).toContain('social_profile_sections:section:1')
    expect(input.rawMongoDocuments.posts[0].truncated).toBe(true)
    expect(input.rawMongoDocuments.authoredComments.map(item => item.id)).toEqual(['social_comments:comment:own'])
    expect(input.rawMongoDocuments.discordMessages.map(item => item.id)).toEqual(['discord_messages:discord:own'])
    expect(input.rawMongoDocuments.whatsappMessages.map(item => item.id)).toEqual(['whatsapp_messages:whatsapp:own'])
    expect(input.rawMongoDocuments.textSamples.map(item => item.id)).toEqual(['user_text_samples:sample:own'])
    expect(input.rawMongoDocuments.knowledgeDocuments.map(item => item.id)).toEqual(['approved_knowledge_documents:knowledge:approved'])
    expect(input.rawMongoDocuments.adaptations.map(item => item.id)).toEqual(['interpreter_adaptations:adaptation:1'])
    expect(JSON.stringify(input.rawMongoDocuments)).not.toContain('never-include@example.test')
    expect(JSON.stringify(input.rawMongoDocuments)).not.toContain('555-0100')
    expect(JSON.stringify(input.rawMongoDocuments)).not.toContain('416-555-0199')
    expect(JSON.stringify(input.rawMongoDocuments)).not.toContain('other discord message')
    expect(input.evidenceIds).toContain('discord_messages:discord:own')
  })

  it('uses bounded, fair input budgets instead of rejecting oversized evidence', async () => {
    const input = await loadRawAccountPromptInput(userId, database)
    const stats = input.sourceStats
    expect(stats.find(stat => stat.source === 'posts')).toMatchObject({ truncated: true })
    expect(stats.reduce((total, stat) => total + stat.charactersIncluded, 0)).toBeLessThanOrEqual(MAX_TOTAL_BUILDER_INPUT_CHARS)
    expect(stats.every(stat => stat.charactersIncluded <= MAX_CHARS_PER_SOURCE)).toBe(true)
  })

  it('updates the resolved profile when a later scrape adds an external id', async () => {
    const regressionUserId = 'usr_profile_id_regression'
    const sourceUrl = 'https://www.linkedin.com/in/alex-example/'
    const originalProfileId = new ObjectId()
    await database.collection('users').insertOne({ _id: regressionUserId, displayName: 'Alex' })
    await database.collection('linkedin_profiles').insertOne({
      _id: originalProfileId,
      userId: regressionUserId,
      platform: 'linkedin',
      sourceUrl,
    })
    await database.collection('social_posts').insertOne({
      userId: regressionUserId,
      profileId: originalProfileId,
      platform: 'linkedin',
      externalId: 'post:existing',
      text: 'Stale post text',
      staleField: 'remove this on refresh',
    })

    await expect(storeSocialImport({
      profile: {
        platform: 'linkedin',
        externalId: 'linkedin-newly-available-id',
        handle: 'alex-example',
        name: 'Alex',
        headline: 'Designer',
        bio: 'Builds accessible tools.',
        avatarUrl: null,
        coverImageUrl: null,
        location: null,
        followerCount: null,
        followingCount: null,
        connectionCount: null,
        isVerified: false,
        sourceUrl,
      },
      posts: [{
        externalId: 'post:existing',
        url: 'https://www.linkedin.com/posts/alex-example-existing/',
        text: 'Fresh post text',
        kind: 'image',
        imageUrl: 'https://images.example.test/fresh.jpg',
        publishedAt: '2026-09-20T02:00:00.000Z',
        likeCount: 10,
        commentCount: 2,
        viewCount: 50,
        sourceData: { id: 'post:existing', commentary: 'Fresh post text' },
      }],
      comments: [],
      sections: [],
      profileImage: null,
      coverImage: null,
      profileSourceData: { id: 'linkedin-newly-available-id', sourceUrl },
    }, regressionUserId)).resolves.toMatchObject({ profileId: originalProfileId.toHexString(), userId: regressionUserId })

    const profiles = await database.collection('linkedin_profiles').find({ userId: regressionUserId }).toArray()
    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toMatchObject({ _id: originalProfileId, id: 'linkedin-newly-available-id' })
    const posts = await database.collection('social_posts').find({ userId: regressionUserId }).toArray()
    expect(posts).toEqual([expect.objectContaining({
      profileId: originalProfileId,
      externalId: 'post:existing',
      text: 'Fresh post text',
      kind: 'image',
      likeCount: 10,
      commentCount: 2,
      viewCount: 50,
    })])
    expect(posts[0]).not.toHaveProperty('staleField')
  })
})
