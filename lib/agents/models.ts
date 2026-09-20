import type { PersonKey } from '@/lib/psychology/schemas'

export function agentModel(key: PersonKey, role: 'speaker' | 'reaction') {
  const speaker = process.env[`OPENAI_MODEL_${key.toUpperCase()}`] || process.env.OPENAI_MODEL || 'gpt-5.6-luna'
  return role === 'reaction' ? process.env.OPENAI_REACTION_MODEL || speaker : speaker
}
