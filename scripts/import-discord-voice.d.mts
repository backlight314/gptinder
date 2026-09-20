export function normalizeDiscordExport(userId: string, exported: unknown): Array<{
  _id: string
  userId: string
  source: string
  externalId: string
  text: string
  createdAt: Date
}>
