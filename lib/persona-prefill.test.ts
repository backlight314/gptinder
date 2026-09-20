import { describe, expect, it } from 'vitest'
import { buildPersonaPrefill } from './persona-prefill'

describe('buildPersonaPrefill', () => {
  it('derives conservative fields from reviewed profile text and public posts', () => {
    const persona = buildPersonaPrefill({
      userId: 'usr-1',
      name: 'Amaan Patel',
      role: 'Builder',
      profileTexts: ['Building tools for thoughtful communities.'],
      posts: ['#designing small experiments', 'What are you learning this week? ✨'],
    })

    expect(persona.name).toBe('Amaan Patel')
    expect(persona.bio).toBe('Building tools for thoughtful communities.')
    expect(persona.interests).toEqual(expect.arrayContaining(['designing', 'experiments', 'learning']))
    expect(persona.traits).toEqual(expect.arrayContaining(['concise', 'question-driven', 'direct']))
    expect(persona.values).toEqual([])
    expect(persona.lifeGoals.wantChildren).toBe('not_disclosed')
    expect(persona.relationshipPreferences.communication).toBe('not_disclosed')
  })
})
