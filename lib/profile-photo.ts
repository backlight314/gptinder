export function profilePhoto(record: Record<string, unknown> | null): string | null {
  if (!record) return null
  for (const value of [record.avatarUrl, record.profilePicUrlHD, record.profilePicUrl, record.profilePicture, record.photo, record.profile_image_url_https, record.profile_image_url]) {
    const object = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    const sizes = Array.isArray(object.sizes) ? object.sizes : []
    const candidate = typeof value === 'string' ? value : object.url || object.pictureUrl || sizes.find(size => size && typeof size.url === 'string')?.url
    if (typeof candidate !== 'string') continue
    try {
      const url = new URL(candidate)
      if (url.protocol === 'https:' && !url.username && !url.password) return url.href
    } catch { /* Missing or malformed photos use initials. */ }
  }
  return null
}

export const SAFE_PROFILE_IMAGE_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

export function profileInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return `${parts[0]?.[0] || ''}${parts.length > 1 ? parts.at(-1)?.[0] || '' : ''}`.toUpperCase()
}

export function safeProviderPhotoUrl(value: string, platform: 'linkedin' | 'instagram' | 'x'): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    const hostname = url.hostname.toLowerCase()
    const allowed = platform === 'linkedin'
      ? hostname === 'licdn.com' || hostname.endsWith('.licdn.com')
      : platform === 'x'
        ? hostname === 'twimg.com' || hostname.endsWith('.twimg.com')
        : hostname === 'cdninstagram.com' || hostname.endsWith('.cdninstagram.com')
          || hostname === 'fbcdn.net' || hostname.endsWith('.fbcdn.net')
    return allowed ? url.href : null
  } catch {
    return null
  }
}
