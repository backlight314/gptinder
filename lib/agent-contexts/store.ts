import 'server-only'

import type { Db, Document } from 'mongodb'
import { buildAccountContext } from '@/lib/agents/openai'
import { getMongoDatabase } from '@/lib/mongodb'
import { loadRawAccountPromptInput, PROMPT_INPUT_SOURCES } from './raw-input'
import { MAX_STORED_ACCOUNT_PROMPT_CHARS, type AgentContext, type AgentContextSnapshot, type AgentContextView, type SourceStat } from './schemas'

type AgentContextDocument = Document & AgentContext

function minimalPrompt() {
  return `## Identity and personality\nNot disclosed. Do not infer traits that are not supported by account evidence.\n\n## Preferences, values, goals, and boundaries\nNot disclosed. Ask naturally rather than assuming preferences or boundaries.\n\n## Approved knowledge and interests\nNot known. Do not present unknown information as personal experience.\n\n## Texting style\nUse a restrained, natural neutral style. Do not invent a distinctive voice.`
}

function zeroSourceStats(): SourceStat[] {
  return PROMPT_INPUT_SOURCES.map((source) => ({
    source,
    documentsRead: 0,
    documentsIncluded: 0,
    charactersIncluded: 0,
    truncated: false,
  }))
}

function zeroSourceDigests() {
  return Object.fromEntries(PROMPT_INPUT_SOURCES.map((source) => [source, '']))
}

function assertValidContext(document: Document | null, userId: string): AgentContext {
  if (!document) throw new Error(`Agent context missing for ${userId}`)
  if (document.userId !== userId || typeof document.revision !== 'number' || document.revision < 0
    || typeof document.compiledPrompt !== 'string' || !document.compiledPrompt.trim()
    || !Array.isArray(document.sourceEvidenceIds) || !Array.isArray(document.sourceStats)
    || !(document.builtAt instanceof Date) || !(document.updatedAt instanceof Date)) {
    throw new Error(`Agent context is invalid for ${userId}`)
  }
  return document as AgentContext
}

export function agentContextView(context: AgentContext): AgentContextView {
  return {
    revision: context.revision,
    compiledPrompt: context.compiledPrompt,
    sourceEvidenceIds: context.sourceEvidenceIds,
    sourceStats: context.sourceStats,
    builtAt: context.builtAt.toISOString(),
    updatedAt: context.updatedAt.toISOString(),
  }
}

export async function ensureMinimalAgentContext(userId: string, database?: Db) {
  const db = database ?? await getMongoDatabase()
  const now = new Date()
  const context = await db.collection<AgentContextDocument>('agent_contexts').findOneAndUpdate(
    { userId },
    {
      $setOnInsert: {
        userId,
        revision: 0,
        compiledPrompt: minimalPrompt(),
        sourceEvidenceIds: [],
        sourceDigests: zeroSourceDigests(),
        sourceStats: zeroSourceStats(),
        builtAt: now,
        updatedAt: now,
      },
    },
    { upsert: true, returnDocument: 'after' },
  )
  return assertValidContext(context, userId)
}

export async function getRequiredAgentContext(userId: string, database?: Db): Promise<AgentContext> {
  const db = database ?? await getMongoDatabase()
  return assertValidContext(await db.collection<AgentContextDocument>('agent_contexts').findOne({ userId }), userId)
}

export async function rebuildAgentContext(userId: string, database?: Db): Promise<AgentContext> {
  const db = database ?? await getMongoDatabase()
  await getRequiredAgentContext(userId, db)
  const rawInput = await loadRawAccountPromptInput(userId, db)
  const output = await buildAccountContext({
    userId,
    rawMongoDocuments: rawInput.rawMongoDocuments,
    sourceStats: rawInput.sourceStats,
    model: process.env.OPENAI_VOICE_MODEL || process.env.OPENAI_MODEL || process.env.OPENAI_MODEL_A || 'gpt-5.6-luna',
  })
  const citedIds = Array.from(new Set(output.sourceEvidenceIds))
  const allowedIds = new Set(rawInput.evidenceIds)
  if (citedIds.some((id) => !allowedIds.has(id)))
    throw new Error('Voice Prompt Builder cited evidence that was not in the bounded account input')
  if (!output.compiledPrompt.trim() || output.compiledPrompt.length > MAX_STORED_ACCOUNT_PROMPT_CHARS)
    throw new Error('Voice Prompt Builder returned an invalid account prompt')

  const now = new Date()
  const context = await db.collection<AgentContextDocument>('agent_contexts').findOneAndUpdate(
    { userId },
    {
      $set: {
        compiledPrompt: output.compiledPrompt.trim(),
        sourceEvidenceIds: citedIds,
        sourceDigests: rawInput.sourceDigests,
        sourceStats: rawInput.sourceStats,
        builtAt: now,
        updatedAt: now,
      },
      $inc: { revision: 1 },
    },
    { returnDocument: 'after' },
  )
  return assertValidContext(context, userId)
}

// A new account is immediately usable even when the model service is unavailable.
// Later rebuilds intentionally preserve the last valid prompt on failure.
export async function initializeNewAgentContext(userId: string, database?: Db): Promise<AgentContext> {
  const db = database ?? await getMongoDatabase()
  const minimal = await ensureMinimalAgentContext(userId, db)
  try {
    return await rebuildAgentContext(userId, db)
  } catch (error) {
    console.error('Initial agent context build failed; retaining the deterministic minimal context', error)
    return minimal
  }
}

export async function snapshotRequiredAgentContext(userId: string, database?: Db): Promise<AgentContextSnapshot> {
  const context = await getRequiredAgentContext(userId, database)
  return { revision: context.revision, compiledPrompt: context.compiledPrompt }
}
