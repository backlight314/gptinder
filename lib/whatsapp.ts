/** Browser-only parsing. Raw exports must never be sent to an API. */
export interface ParsedMessage {
  id: string
  author: string
  text: string
  timestamp: string
}
export type DateOrder = 'auto' | 'DMY' | 'MDY'
const HEADER =
  /^(?:\[)?(\d{1,4}[/.\-]\d{1,2}[/.\-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*([ap]m))?(?:\]\s*|\s+-\s+)(.*)$/i

export function parseWhatsApp(
  text: string,
  dateOrder: DateOrder = 'auto',
): ParsedMessage[] {
  if (text.length > 2_000_000)
    throw new Error('Choose a text export under 2 MB.')
  const lines = text.replace(/[\u200e\u200f\u202a-\u202e]/g, '').split(/\r?\n/)
  const headers = lines
    .map((line) => line.match(HEADER))
    .filter((m) => m !== null)
  if (!headers.length)
    throw new Error(
      'Unsupported export format. Use an Android or iOS WhatsApp text export.',
    )
  const inferred = new Set(
    headers.flatMap((m) => {
      const parts = m[1].split(/[/.\-]/)
      if (parts[0].length === 4) return []
      return Number(parts[0]) > 12
        ? ['DMY']
        : Number(parts[1]) > 12
          ? ['MDY']
          : []
    }),
  )
  if (inferred.size > 1)
    throw new Error(
      'Mixed date formats are ambiguous. Import a single consistent export.',
    )
  const order = dateOrder === 'auto' ? [...inferred][0] : dateOrder
  if (!order && headers.some((m) => m[1].split(/[/.\-]/)[0].length !== 4))
    throw new Error(
      'Ambiguous dates. Select day/month/year or month/day/year, then reopen the file.',
    )
  const messages: ParsedMessage[] = []
  let current: ParsedMessage | null = null
  for (const [index, raw] of lines.entries()) {
    const line = raw.trimEnd()
    const header = line.match(HEADER)
    if (header) {
      current = null
      const parts = header[1].split(/[/.\-]/)
      const iso = parts[0].length === 4
      const year =
        Number(iso ? parts[0] : parts[2]) +
        (!iso && parts[2].length === 2 ? 2000 : 0)
      const month = Number(
        iso ? parts[1] : order === 'DMY' ? parts[1] : parts[0],
      )
      const day = Number(iso ? parts[2] : order === 'DMY' ? parts[0] : parts[1])
      const [hour, minute, second = 0] = header[2].split(':').map(Number)
      const calendar = new Date(Date.UTC(year, month - 1, day))
      if (
        calendar.getUTCFullYear() !== year ||
        calendar.getUTCMonth() !== month - 1 ||
        calendar.getUTCDate() !== day ||
        minute > 59 ||
        second > 59 ||
        (header[3] ? hour < 1 || hour > 12 : hour > 23)
      )
        throw new Error(
          `Invalid date/time at line ${index + 1}. Check the selected date order.`,
        )
      const authored = header[4].match(/^([^:\r\n]{1,100}): (.*)$/)
      if (!authored) continue // Known timestamped system event, not an authored message.
      const author = authored[1].trim()
      if (!author) throw new Error(`Ambiguous sender at line ${index + 1}.`)
      const localHour = header[3]
        ? (hour % 12) + (header[3].toLowerCase() === 'pm' ? 12 : 0)
        : hour
      const timestamp = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(localHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
      current = {
        id: `message-${messages.length + 1}`,
        author,
        text: authored[2],
        timestamp,
      }
      messages.push(current)
    } else {
      if (/^\[?\d{1,4}[/.\-]\d{1,2}[/.\-]/.test(line))
        throw new Error(
          `Unsupported or ambiguous message header at line ${index + 1}.`,
        )
      if (current) {
        if (current.text.length + line.length > 4000)
          throw new Error('An exported message exceeds the supported length.')
        current.text += '\n' + line
      } else if (line.trim() && !/end-to-end encrypted/i.test(line))
        throw new Error(
          `Unrecognized text outside a message at line ${index + 1}.`,
        )
    }
  }
  const seen = new Set<string>()
  return messages
    .filter((message) => {
      // Drop entire quoted/forwarded messages conservatively, not just the identifying header.
      if (
        /(?:media omitted|image omitted|video omitted|audio omitted|sticker omitted|document omitted|contact card omitted|this message was deleted|you deleted this message|<attached:)/i.test(
          message.text,
        ) ||
        /(?:^|\n)\s*(?:>|Forwarded\b|Replying to\b|Quoted message\b)/i.test(
          message.text,
        )
      )
        return false
      const key =
        message.author +
        ':' +
        message.text.toLowerCase().replace(/\s+/g, ' ').trim()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 20000)
}
export function redactParticipants(text: string, names: string[]) {
  let result = text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/https?:\/\/\S+/g, '[link]')
    .replace(/(?:\+?\d[\d ()-]{7,}\d)/g, '[number]')
  for (const name of names
    .filter((n) => n.length > 1)
    .sort((a, b) => b.length - a.length))
    result = result.replace(
      new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
      '[name]',
    )
  return result
}
