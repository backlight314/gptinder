import { z } from 'zod'
export const badgeTokenSchema = z.string().regex(/^[a-f0-9]{32}$/)
export const nonceSchema = z.string().regex(/^[a-f0-9]{16}$/)
const handshakeSchema = z
  .object({
    type: z.literal('gptinder.encounter'),
    version: z.literal(1),
    localToken: badgeTokenSchema,
    peerToken: badgeTokenSchema,
    localNonce: nonceSchema,
    peerNonce: nonceSchema,
  })
  .strict()
  .refine(
    (v) => v.localToken !== v.peerToken,
    'Cannot encounter your own badge',
  )
export const bumpSchema = handshakeSchema.refine(
  (v) => v.localToken < v.peerToken,
  'Only the badge elected by the pair may report this encounter',
)
export type BumpEvent = z.infer<typeof bumpSchema>
export function isElectedSender(localToken: string, peerToken: string) {
  badgeTokenSchema.parse(localToken)
  badgeTokenSchema.parse(peerToken)
  return localToken < peerToken
}
export const SERIAL_PREFIX = 'GPTINDER:'
export function parseBadgeLine(line: string): BumpEvent | null {
  // Firmware prepends its app-slug log tag. Accept the marker only once.
  const marker = line.indexOf(SERIAL_PREFIX)
  if (
    marker < 0 ||
    line.length > 1024 ||
    line.indexOf(SERIAL_PREFIX, marker + 1) >= 0
  )
    return null
  try {
    const result = bumpSchema.safeParse(
      JSON.parse(line.slice(marker + SERIAL_PREFIX.length)),
    )
    return result.success ? result.data : null
  } catch {
    return null
  }
}
export function canonicalHandshake(event: BumpEvent) {
  handshakeSchema.parse(event)
  return JSON.stringify(
    [
      [event.localToken, event.localNonce],
      [event.peerToken, event.peerNonce],
    ].sort(([a], [b]) => a.localeCompare(b)),
  )
}
/** Bounded decoder for split chunks, CRLF and noisy USB logs. */
export class SerialLines {
  private buffer = ''
  private discarding = false
  push(chunk: string): BumpEvent[] {
    const events: BumpEvent[] = []
    for (const char of chunk) {
      if (char === '\n') {
        if (!this.discarding) {
          const event = parseBadgeLine(this.buffer.replace(/\r$/, ''))
          if (event) events.push(event)
        }
        this.buffer = ''
        this.discarding = false
      } else if (!this.discarding) {
        this.buffer += char
        if (this.buffer.length > 1024) {
          this.buffer = ''
          this.discarding = true
        }
      }
    }
    return events
  }
}
