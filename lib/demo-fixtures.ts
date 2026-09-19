import type { Features, Preferences, Shareable } from './domain'

export const DEMO_PREFERENCES: Preferences = {
  planning: { desired: 0.9, importance: 1 },
  socialSetting: { desired: 0.3, importance: 1 },
  communication: { desired: 0.7, importance: 1 },
  independence: { desired: 0.6, importance: 1 },
  novelty: { desired: 0.7, importance: 1 },
}
export const PARTNER_FEATURES: Features = {
  planning: 0.1,
  socialSetting: 0.4,
  communication: 0.6,
  independence: 0.5,
  novelty: 0.6,
}
export const DEMO_PEOPLE: { id: string; name: string; profile: Shareable }[] = [
  {
    id: '00000000-0000-4000-a000-000000000001',
    name: 'Alex',
    profile: {
      summary:
        'I enjoy a quiet afternoon, thoughtful conversation, and knowing the plan ahead of time. I appreciate curiosity and enough space for individual interests.',
      traits: ['Thoughtful', 'Curious', 'Organized'],
      interests: ['Coffee', 'Museums', 'Walking'],
      style: 'Warm, direct, and happy to clarify plans.',
      features: {
        planning: 0.9,
        socialSetting: 0.3,
        communication: 0.7,
        independence: 0.6,
        novelty: 0.7,
      },
    },
  },
  ...['Blair', 'Casey'].map((name, i) => ({
    id: `00000000-0000-4000-a000-00000000000${i + 2}`,
    name,
    profile: {
      summary:
        'I like a relaxed afternoon with room for spontaneous changes. A small cafe or a new neighborhood walk sounds good, and I am comfortable talking through options together.',
      traits: ['Flexible', 'Warm', 'Curious'],
      interests: ['Coffee', 'Museums', 'Walking'],
      style: 'Friendly, collaborative, and comfortable with last-minute ideas.',
      features: { ...PARTNER_FEATURES },
    },
  })),
]
