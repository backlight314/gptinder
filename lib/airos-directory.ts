import { z } from 'zod'

export const AIROS_BADGE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+){3}$/
export const AIROS_CONTACT_FILE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+){3}\.cfg$/
export const AIROS_MAX_CONTACTS = 250

const optionalText = (maximum: number) => z.string().trim().max(maximum).optional()

export const badgeProfileInputSchema = z.object({
  badgeId: z.string().trim().toLowerCase().max(80).regex(AIROS_BADGE_ID_PATTERN),
  kind: z.enum(['owner', 'contact']),
  name: z.string().trim().min(1).max(120),
  email: optionalText(254),
  phone: optionalText(40),
  linkedin: optionalText(300),
  instagram: optionalText(300),
  x: optionalText(300),
  discord: optionalText(120),
  role: optionalText(40),
  rippleDepth: z.number().int().min(-1).max(1_000_000).optional(),
  receivedUnix: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
}).strict()

export const badgeImportBatchSchema = z.object({
  owner: badgeProfileInputSchema.extend({ kind: z.literal('owner') }),
  contacts: z.array(badgeProfileInputSchema.extend({ kind: z.literal('contact') })).max(AIROS_MAX_CONTACTS),
}).strict()

export type BadgeProfileInput = z.infer<typeof badgeProfileInputSchema>
export type BadgeImportBatch = z.infer<typeof badgeImportBatchSchema>
export type PreviewStatus = 'new' | 'fills_missing' | 'existing' | 'conflict'

export type PreviewRecord = {
  badgeId: string
  name: string
  kind: BadgeProfileInput['kind']
  status: PreviewStatus
  fills: string[]
  conflicts: string[]
  profileUrl: string
}

export type ImportSummary = {
  importId: string
  newProfiles: number
  updatedProfiles: number
  existingProfiles: number
  conflicts: number
  invalidProfiles: number
  connections: number
  profiles: PreviewRecord[]
}

export const BADGE_PUBLIC_FIELDS = ['name', 'email', 'phone', 'linkedin', 'instagram', 'x', 'discord', 'role'] as const
export type BadgePublicField = (typeof BADGE_PUBLIC_FIELDS)[number]

export function classifyBadgeProfile(
  existing: Partial<Record<BadgePublicField, string | null>> | null,
  input: BadgeProfileInput,
) {
  if (!existing) return { status: 'new' as const, fills: BADGE_PUBLIC_FIELDS.filter((field) => Boolean(input[field])), conflicts: [] as string[] }
  const fills: string[] = []
  const conflicts: string[] = []
  for (const field of BADGE_PUBLIC_FIELDS) {
    const incoming = typeof input[field] === 'string' && input[field]?.trim() ? input[field]!.trim() : null
    const current = typeof existing[field] === 'string' && existing[field]?.trim() ? existing[field]!.trim() : null
    if (incoming && !current) fills.push(field)
    else if (incoming && current && incoming !== current) conflicts.push(field)
  }
  return {
    status: conflicts.length ? 'conflict' as const : fills.length ? 'fills_missing' as const : 'existing' as const,
    fills,
    conflicts,
  }
}

const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g

export function stripSerialControlSequences(value: string) {
  return value
    .replace(ANSI_PATTERN, '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

export function normalizeBadgeId(value: string) {
  const badgeId = value.trim().toLowerCase()
  return AIROS_BADGE_ID_PATTERN.test(badgeId) ? badgeId : null
}

function cleanOptional(value: unknown, maximum: number) {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return cleaned && cleaned.length <= maximum ? cleaned : undefined
}

function normalizeEmail(value: unknown) {
  const cleaned = cleanOptional(value, 254)?.toLowerCase()
  if (!cleaned || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return undefined
  return cleaned
}

function normalizePhone(value: unknown) {
  const cleaned = cleanOptional(value, 40)
  if (!cleaned || !/^[+()\d .-]{5,40}$/.test(cleaned)) return undefined
  return cleaned.replace(/\s+/g, ' ')
}

function socialHandle(value: unknown, platform: 'linkedin' | 'instagram' | 'x') {
  let cleaned = cleanOptional(value, 300)
  if (!cleaned) return undefined
  cleaned = cleaned.replace(/^@/, '')

  try {
    const candidate = new URL(/^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`)
    const host = candidate.hostname.toLowerCase().replace(/^www\./, '')
    const parts = candidate.pathname.split('/').filter(Boolean)
    if (platform === 'linkedin' && host === 'linkedin.com' && parts[0]?.toLowerCase() === 'in') cleaned = parts[1] || ''
    if (platform === 'instagram' && host === 'instagram.com') cleaned = parts[0] || ''
    if (platform === 'x' && (host === 'x.com' || host === 'twitter.com')) cleaned = parts[0] || ''
  } catch {
    // Plain badge values are handles, not URLs.
  }

  cleaned = cleaned.replace(/^@/, '').replace(/\/$/, '')
  if (platform === 'linkedin' && /^[A-Za-z0-9_-]{1,100}$/.test(cleaned)) {
    return `https://www.linkedin.com/in/${encodeURIComponent(cleaned)}`
  }
  if (platform === 'instagram' && /^[A-Za-z0-9._]{1,30}$/.test(cleaned)) {
    return `https://www.instagram.com/${encodeURIComponent(cleaned)}`
  }
  if (platform === 'x' && /^[A-Za-z0-9_]{1,15}$/.test(cleaned)) {
    return `https://x.com/${encodeURIComponent(cleaned)}`
  }
  return undefined
}

function optionalInteger(value: unknown, minimum = 0) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : undefined
}

export function normalizeBadgeProfile(raw: Record<string, unknown>, kind: 'owner'): BadgeProfileInput & { kind: 'owner' } | null
export function normalizeBadgeProfile(raw: Record<string, unknown>, kind: 'contact'): BadgeProfileInput & { kind: 'contact' } | null
export function normalizeBadgeProfile(
  raw: Record<string, unknown>,
  kind: BadgeProfileInput['kind'],
): BadgeProfileInput | null {
  const badgeId = normalizeBadgeId(String(raw.badge_id ?? raw.badgeId ?? ''))
  const name = cleanOptional(raw.display_name ?? raw.name, 120)
  if (!badgeId || !name) return null

  const candidate: BadgeProfileInput = {
    badgeId,
    kind,
    name,
    email: normalizeEmail(raw.net_email ?? raw.email ?? raw.account_email),
    phone: normalizePhone(raw.net_phone ?? raw.phone),
    linkedin: socialHandle(raw.net_linkedin ?? raw.linkedin, 'linkedin'),
    instagram: socialHandle(raw.instagram, 'instagram'),
    x: socialHandle(raw.net_x ?? raw.x, 'x'),
    discord: cleanOptional(raw.discord, 120),
    role: cleanOptional(raw.role, 40),
    rippleDepth: optionalInteger(raw.ripple_depth, -1),
    receivedUnix: optionalInteger(raw.received_unix),
  }
  return badgeProfileInputSchema.safeParse(candidate).success ? candidate : null
}

export function parseIdentityOutput(output: string) {
  const clean = stripSerialControlSequences(output)
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(clean.slice(start, end + 1))
    return parsed && typeof parsed === 'object'
      ? normalizeBadgeProfile(parsed as Record<string, unknown>, 'owner')
      : null
  } catch {
    return null
  }
}

export function parseContactOutput(output: string) {
  const fields: Record<string, string> = {}
  for (const line of stripSerialControlSequences(output).split('\n')) {
    const match = line.match(/^([a-z_]+)=(.*)$/)
    if (match) fields[match[1]] = match[2].trim()
  }
  return normalizeBadgeProfile(fields, 'contact')
}

export function parseContactListing(output: string) {
  const files = new Set<string>()
  for (const match of stripSerialControlSequences(output).matchAll(/\b([a-z]+(?:-[a-z]+){3}\.cfg)\b/g)) {
    if (AIROS_CONTACT_FILE_PATTERN.test(match[1])) files.add(match[1])
  }
  return [...files].sort()
}

export function deduplicateImportBatch(batch: BadgeImportBatch): BadgeImportBatch {
  const contacts = new Map<string, BadgeImportBatch['contacts'][number]>()
  for (const contact of batch.contacts) {
    if (contact.badgeId === batch.owner.badgeId) continue
    const previous = contacts.get(contact.badgeId)
    if (!previous) {
      contacts.set(contact.badgeId, contact)
      continue
    }
    contacts.set(contact.badgeId, mergeIncomingProfiles(previous, contact))
  }
  return { owner: batch.owner, contacts: [...contacts.values()] }
}

function mergeIncomingProfiles<T extends BadgeProfileInput>(first: T, second: BadgeProfileInput): T {
  const merged = { ...first }
  for (const key of ['email', 'phone', 'linkedin', 'instagram', 'x', 'discord', 'role'] as const) {
    if (!merged[key] && second[key]) merged[key] = second[key]
  }
  if (merged.rippleDepth === undefined && second.rippleDepth !== undefined) merged.rippleDepth = second.rippleDepth
  if (merged.receivedUnix === undefined && second.receivedUnix !== undefined) merged.receivedUnix = second.receivedUnix
  return merged as T
}

export function importBatchFromSerial(
  identityOutput: string,
  contactOutputs: Array<{ file: string; output: string }>,
) {
  const owner = parseIdentityOutput(identityOutput)
  if (!owner) return { batch: null, invalid: ['identity.json'] }

  const invalid: string[] = []
  const contacts = contactOutputs.flatMap(({ file, output }) => {
    const contact = parseContactOutput(output)
    if (!contact) {
      invalid.push(file)
      return []
    }
    return [contact]
  })
  const parsed = badgeImportBatchSchema.safeParse({ owner, contacts })
  return parsed.success
    ? { batch: deduplicateImportBatch(parsed.data), invalid }
    : { batch: null, invalid: [...invalid, 'batch'] }
}
