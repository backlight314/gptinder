import { loadEnvConfig } from '@next/env'
import { z } from 'zod'
import { generateStructured } from '../lib/server/ai'

loadEnvConfig(process.cwd())
async function main() {
  const output = await generateStructured(
    z.object({ status: z.literal('ok') }),
    'Return status ok for this connectivity test.',
    { purpose: 'configuration check; no participant data' },
    { attempts: 1 },
  )
  if (output.status !== 'ok') throw new Error('Invalid connectivity result')
  console.log('OpenAI structured Responses connectivity check passed.')
}
main().catch(() => {
  console.error(
    'OpenAI check failed. Verify OPENAI_API_KEY, OPENAI_MODEL, project access, billing and network connectivity. No credentials or provider payloads were logged.',
  )
  process.exitCode = 1
})
