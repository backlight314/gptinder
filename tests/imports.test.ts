import { describe, expect, it } from 'vitest'
import { parseWhatsApp, redactParticipants } from '../lib/whatsapp'
import { copiesPrivatePassage, styleDistance } from '../lib/style-safety'
import { importInputSchema } from '../lib/import-domain'
import { randomUUID } from 'node:crypto'
import { writingStatistics } from '../lib/writing-statistics'

describe('local WhatsApp selection', () => {
  it('parses Android/iOS, multiline text and ignores system/media lines', () => {
    const android =
      '19/09/2026, 9:01 am - Messages are end-to-end encrypted\n19/09/2026, 9:02 am - Alex: Hello there\nA second line\n19/09/2026, 9:03 am - Blair: <Media omitted>'
    expect(parseWhatsApp(android)).toMatchObject([
      { id: 'message-1', author: 'Alex', text: 'Hello there\nA second line' },
    ])
    expect(
      parseWhatsApp(
        '[19/09/2026, 09:02:00] Alex: Sounds good!\n[19/09/2026, 09:03:00] Blair: Great.',
      ).map((m) => m.author),
    ).toEqual(['Alex', 'Blair'])
  })
  it('redacts known participant names, addresses and links before selection', () => {
    expect(
      redactParticipants(
        'Ask Blair at blair@example.com or https://example.com',
        ['Blair'],
      ),
    ).not.toContain('Blair')
    expect(
      redactParticipants('Reach alex@example.com and https://example.com', []),
    ).toBe('Reach [email] and [link]')
    expect(() => parseWhatsApp('x'.repeat(2_000_001))).toThrow()
  })
  it('requires bounded self-attributed samples and a held-out set', () => {
    const input = {
      label: 'Examples',
      reviewed: true,
      ownMessagesOnly: true,
      samples: [0, 1, 2].map((i) => ({
        id: randomUUID(),
        text: `A selected writing example number ${i}.`,
        author: 'self',
        role: i === 2 ? 'holdout' : 'training',
      })),
    }
    expect(importInputSchema.safeParse(input).success).toBe(true)
    expect(
      importInputSchema.safeParse({
        ...input,
        samples: input.samples.map((s) => ({ ...s, role: 'training' })),
      }).success,
    ).toBe(false)
    expect(
      importInputSchema.safeParse({
        ...input,
        samples: input.samples.map((s) => ({ ...s, author: 'someone else' })),
      }).success,
    ).toBe(false)
  })
})
describe('style-only evaluation', () => {
  it('rejects ambiguous dates, impossible dates and malformed headers', () => {
    expect(() =>
      parseWhatsApp('09/10/2026, 09:00 - Alex: Hello there'),
    ).toThrow('Ambiguous')
    expect(
      parseWhatsApp('09/10/2026, 09:00 - Alex: Hello there', 'DMY')[0]
        .timestamp,
    ).toContain('2026-10-09')
    expect(() =>
      parseWhatsApp('31/02/2026, 09:00 - Alex: Hello there'),
    ).toThrow('Invalid')
    expect(() =>
      parseWhatsApp(
        '19/09/2026, 09:00 - Alex: Hello\n19/09/2026 broken header',
      ),
    ).toThrow('ambiguous')
  })
  it('drops detectable quoted material and duplicate authored messages', () => {
    const parsed = parseWhatsApp(
      '19/09/2026, 09:00 - Alex: Hello there\n19/09/2026, 09:01 - Alex: Hello there\n19/09/2026, 09:02 - Alex: > Blair: private quote\n19/09/2026, 09:03 - Alex: Forwarded\nprivate text',
    )
    expect(parsed.map((m) => m.text)).toEqual(['Hello there'])
  })
  it('keeps descriptive statistics separate and accepts factual professional text', () => {
    expect(writingStatistics(["Let's go? 😊", 'Okay!'])).toMatchObject({
      count: 2,
      questionRate: 0.5,
      emojiRate: 0.5,
      contractionRate: 0.5,
    })
    expect(
      importInputSchema.safeParse({
        sourceType: 'professional',
        label: 'My résumé',
        reviewed: true,
        ownMessagesOnly: true,
        samples: [
          {
            id: randomUUID(),
            author: 'self',
            role: 'training',
            text: 'I build robotics projects.',
          },
        ],
      }).success,
    ).toBe(true)
  })
  it('rejects a held-out sample duplicated in training', () => {
    expect(
      importInputSchema.safeParse({
        label: 'Duplicate',
        reviewed: true,
        ownMessagesOnly: true,
        samples: [0, 1, 2].map((i) => ({
          id: randomUUID(),
          text: 'The same private passage.',
          author: 'self',
          role: i === 2 ? 'holdout' : 'training',
        })),
      }).success,
    ).toBe(false)
  })
  it('detects private passage copying across punctuation and case', () => {
    expect(
      copiesPrivatePassage('I think the hidden blue boat waits at dawn.', [
        'The hidden blue boat waits at dawn!',
      ]),
    ).toBe(true)
    expect(
      copiesPrivatePassage('Happy to make a plan together.', [
        'My cousin met someone in Paris last June.',
      ]),
    ).toBe(false)
  })
  it('measures style distance without touching compatibility features', () => {
    expect(styleDistance('Hello there!', ['Hello there!'])).toBe(0)
    expect(styleDistance('Hello', [])).toBeNull()
  })
})
