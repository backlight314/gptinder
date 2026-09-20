import { z } from 'zod'

export const MAX_STORED_ACCOUNT_PROMPT_CHARS = 4800

export const sourceStatSchema = z.object({
  source: z.string().min(1).max(80),
  documentsRead: z.number().int().nonnegative(),
  documentsIncluded: z.number().int().nonnegative(),
  charactersIncluded: z.number().int().nonnegative(),
  truncated: z.boolean(),
})

export type SourceStat = z.infer<typeof sourceStatSchema>

export const agentContextBuilderSchema = z.object({
  compiledPrompt: z.string().trim().min(80).max(MAX_STORED_ACCOUNT_PROMPT_CHARS),
  sourceEvidenceIds: z.array(z.string().min(1).max(240)).max(160),
})

export type AgentContextBuilderOutput = z.infer<typeof agentContextBuilderSchema>

export type AgentContext = {
  userId: string
  revision: number
  compiledPrompt: string
  sourceEvidenceIds: string[]
  sourceDigests: Record<string, string>
  sourceStats: SourceStat[]
  builtAt: Date
  updatedAt: Date
}

export type AgentContextSnapshot = Pick<AgentContext, 'revision' | 'compiledPrompt'>

export type AgentContextView = Omit<AgentContext, 'userId' | 'sourceDigests' | 'builtAt' | 'updatedAt'> & {
  builtAt: string
  updatedAt: string
}
