// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'

vi.mock('@/lib/social-import', () => ({ importPublicProfile: vi.fn() }))
vi.mock('@/lib/social-store', () => ({ storeSocialImport: vi.fn() }))
vi.mock('@/lib/social-memory', () => ({ loadSocialVoiceMemory: vi.fn() }))
vi.mock('@/lib/airos-directory-store', () => ({ getProfileDocument: vi.fn() }))

import { importPublicProfile } from '@/lib/social-import'
import { storeSocialImport } from '@/lib/social-store'
import { loadSocialVoiceMemory } from '@/lib/social-memory'
import { getProfileDocument } from '@/lib/airos-directory-store'
import { analyzeAirosProfile } from '@/lib/airos-profile-analysis'

let mongo: MongoMemoryServer

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongo.getUri()
  process.env.MONGODB_DB = 'airos_profile_analysis_tests'
  process.env.OPENAI_API_KEY = 'test-key'
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await (await global.__airosMongoClientPromise)?.close()
  global.__airosMongoClientPromise = undefined
  global.__airosMongoIndexesPromise = undefined
  await mongo?.stop()
})

describe('AIROS profile analysis', () => {
  it('refreshes completed analyses from the source APIs on every request', async () => {
    const profile = {
      badgeId: 'bison-cosmic-dove-star',
      userId: 'usr_airos_c6ae2739425a14644155',
      name: 'Bison',
      linkedin: 'https://www.linkedin.com/in/bison/',
      instagram: null,
      x: null,
      role: null,
    }
    vi.mocked(getProfileDocument).mockResolvedValue(profile as never)
    vi.mocked(importPublicProfile).mockResolvedValue({ profile: { platform: 'linkedin' } } as never)
    vi.mocked(storeSocialImport).mockResolvedValue({} as never)
    vi.mocked(loadSocialVoiceMemory).mockResolvedValue('Fresh imported social sample.')
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        headline: 'A thoughtful collaborator.',
        summary: 'Builds practical projects with care.',
        interests: ['design'],
        conversationStarters: ['What are you making lately?', 'What are you learning?', 'What keeps you curious?'],
      }) }] }],
    }), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    const first = await analyzeAirosProfile(profile.badgeId)
    const second = await analyzeAirosProfile(profile.badgeId)

    expect(first.cached).toBe(false)
    expect(second.cached).toBe(false)
    expect(importPublicProfile).toHaveBeenCalledTimes(2)
    expect(storeSocialImport).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
