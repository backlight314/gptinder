import type { PersonKey } from '@/lib/psychology/schemas'

export function agentModel(key: PersonKey, role: 'speaker' | 'reaction' | 'compatibility') {
  const speaker = process.env[`OPENAI_MODEL_${key.toUpperCase()}`] || process.env.OPENAI_MODEL || 'gpt-5.6-luna'
  if (role === 'reaction') return process.env.OPENAI_REACTION_MODEL || speaker
  if (role === 'compatibility') return process.env.OPENAI_COMPATIBILITY_MODEL || speaker
  return speaker
}
