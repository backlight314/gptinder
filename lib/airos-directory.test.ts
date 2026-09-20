import { describe, expect, it } from 'vitest'
import {
  classifyBadgeProfile,
  deduplicateImportBatch,
  importBatchFromSerial,
  normalizeBadgeProfile,
  parseContactListing,
  parseContactOutput,
  parseIdentityOutput,
  stripSerialControlSequences,
} from './airos-directory'

const identity = JSON.stringify({
  badge_id: 'brave-silver-fox-tree',
  display_name: 'Test Owner',
  net_email: 'OWNER@EXAMPLE.COM',
  net_x: 'https://twitter.com/test_owner',
})

const contact = [
  'badge_id=calm-blue-bird-river',
  'display_name=Test Contact',
  'net_email=contact@example.com',
  'net_linkedin=test-contact',
  'instagram=@test.contact',
  'net_x=https://x.com/test_contact',
  'net_phone=+1 555 010 1111',
].join('\r\n')

describe('badge serial parsing', () => {
  it('strips ANSI and normalizes CR/LF output', () => {
    expect(stripSerialControlSequences('\u001b[32mhello\u001b[0m\r\nworld\r')).toBe('hello\nworld\n')
  })

  it('parses an identity surrounded by stale console output', () => {
    expect(parseIdentityOutput(`badge>\r\ncat /littlefs/identity.json\r\n${identity}\r\nbadge>`)).toMatchObject({
      badgeId: 'brave-silver-fox-tree',
      email: 'owner@example.com',
      x: 'https://x.com/test_owner',
    })
  })

  it('normalizes LinkedIn, Instagram, and X/Twitter aliases to HTTPS URLs', () => {
    expect(parseContactOutput(contact)).toMatchObject({
      linkedin: 'https://www.linkedin.com/in/test-contact',
      instagram: 'https://www.instagram.com/test.contact',
      x: 'https://x.com/test_contact',
    })
    expect(normalizeBadgeProfile({ badge_id: 'tiny-green-owl-lake', display_name: 'X User', net_x: 'twitter.com/twitter_user' }, 'contact')?.x).toBe('https://x.com/twitter_user')
  })

  it('accepts only validated contact filenames and removes duplicates', () => {
    expect(parseContactListing('good-blue-bird-tree.cfg\n../../identity.json\nbad file.cfg\ngood-blue-bird-tree.cfg')).toEqual(['good-blue-bird-tree.cfg'])
  })

  it('reports malformed contact files but retains valid records', () => {
    const parsed = importBatchFromSerial(identity, [
      { file: 'calm-blue-bird-river.cfg', output: contact },
      { file: 'bad-red-fox-tree.cfg', output: 'not-a-contact' },
    ])
    expect(parsed.batch?.contacts).toHaveLength(1)
    expect(parsed.invalid).toEqual(['bad-red-fox-tree.cfg'])
  })

  it('deduplicates a submitted batch without erasing populated fields', () => {
    const owner = parseIdentityOutput(identity)!
    const first = parseContactOutput(contact)!
    const merged = deduplicateImportBatch({
      owner,
      contacts: [first, { ...first, email: undefined, discord: 'tester' }],
    })
    expect(merged.contacts).toHaveLength(1)
    expect(merged.contacts[0]).toMatchObject({ email: 'contact@example.com', discord: 'tester' })
  })

  it('classifies new, unchanged, fill-only, and conflicting profiles', () => {
    const incoming = parseContactOutput(contact)!
    expect(classifyBadgeProfile(null, incoming).status).toBe('new')
    expect(classifyBadgeProfile(incoming, incoming).status).toBe('existing')
    expect(classifyBadgeProfile({ ...incoming, phone: null }, incoming)).toMatchObject({ status: 'fills_missing', fills: ['phone'] })
    expect(classifyBadgeProfile({ ...incoming, email: 'different@example.com' }, incoming)).toMatchObject({ status: 'conflict', conflicts: ['email'] })
  })
})
