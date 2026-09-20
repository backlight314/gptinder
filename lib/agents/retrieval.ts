import 'server-only'
import type { ManualPersona, PersonKey } from '@/lib/psychology/schemas'

export async function retrievePersonaContext(key: PersonKey, persona: ManualPersona) {
  const vectorStoreId = process.env[`OPENAI_VECTOR_STORE_ID_${key.toUpperCase()}`]
  if (!vectorStoreId) return ''
  const response = await fetch(`https://api.openai.com/v1/vector_stores/${encodeURIComponent(vectorStoreId)}/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `Verified context for ${persona.name}: ${persona.bio}. Interests: ${persona.interests.join(', ')}`, max_num_results: 3, rewrite_query: true }),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`Persona retrieval failed (${response.status}).`)
  const result = await response.json() as { data?: Array<{ content?: Array<{ type?: string; text?: string }> }> }
  return (result.data?.flatMap(item => item.content?.flatMap(content => content.type === 'text' && content.text ? [content.text] : []) ?? []) ?? []).join('\n\n').slice(0, 6000)
}
