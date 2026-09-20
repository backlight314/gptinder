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
