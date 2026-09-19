import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
const { parse, construct } = vi.hoisted(() => ({
  parse: vi.fn(),
  construct: vi.fn(),
}))
vi.mock('openai', () => ({
  default: class {
    responses = { parse }
    constructor(options: unknown) {
      construct(options)
    }
  },
}))
import { generateStructured } from '../lib/server/ai'
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})
describe('OpenAI structured generation', () => {
  it('uses server credentials, disables response storage and bounds retries', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubEnv('OPENAI_MODEL', 'test-model')
    parse.mockResolvedValue({
      status: 'completed',
      output_parsed: { text: 'hello' },
    })
    expect(
      await generateStructured(z.object({ text: z.string() }), 'A task', {
        private: 'data',
      }),
    ).toEqual({ text: 'hello' })
    expect(construct).toHaveBeenCalledWith({
      apiKey: 'test-key',
      timeout: 15000,
      maxRetries: 0,
    })
    expect(parse.mock.calls[0][0]).toMatchObject({
      model: 'test-model',
      store: false,
      input: '{"private":"data"}',
      max_output_tokens: 3500,
    })
    expect(parse.mock.calls[0][0].text.format.type).toBe('json_schema')
  })
  it('treats refusals and incomplete responses as bounded recoverable failures', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubEnv('OPENAI_MODEL', 'test-model')
    parse.mockResolvedValue({ status: 'incomplete', output_parsed: null })
    await expect(
      generateStructured(z.object({ text: z.string() }), 'Task', {}),
    ).rejects.toThrow('saved progress is safe')
    expect(parse).toHaveBeenCalledTimes(2)
  })
})
