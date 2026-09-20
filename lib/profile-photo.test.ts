import { describe, expect, it } from 'vitest'
import { profileInitials, profilePhoto, safeProviderPhotoUrl } from './profile-photo'

describe('profile photo selection', () => {
  it('reads normalized and legacy social provider photos', () => {
    expect(profilePhoto({ avatarUrl: 'https://example.com/a.jpg' })).toBe('https://example.com/a.jpg')
    expect(profilePhoto({ profilePicture: { url: 'https://example.com/b.jpg' } })).toBe('https://example.com/b.jpg')
    expect(profilePhoto({ profilePicUrlHD: 'https://example.com/c.jpg' })).toBe('https://example.com/c.jpg')
    expect(profilePhoto({ profile_image_url_https: 'https://example.com/d.jpg' })).toBe('https://example.com/d.jpg')
  })
  it('rejects unsafe or missing URLs and falls back to another usable field', () => {
    expect(profilePhoto(null)).toBeNull()
    expect(profilePhoto({ avatarUrl: 'javascript:alert(1)' })).toBeNull()
    expect(profilePhoto({ avatarUrl: 'https://user:password@example.com/a' })).toBeNull()
    expect(profilePhoto({ avatarUrl: 'invalid', photo: 'https://example.com/fallback.jpg' })).toBe('https://example.com/fallback.jpg')
  })
})

describe('profile photo presentation', () => {
  it('creates useful initials for the local fallback', () => {
    expect(profileInitials('Rohanth Marem')).toBe('RM')
    expect(profileInitials('Rohanth')).toBe('R')
    expect(profileInitials('  ')).toBe('?')
  })

  it('only permits known social image CDNs for server proxying', () => {
    expect(safeProviderPhotoUrl('https://media.licdn.com/photo.jpg', 'linkedin')).toBe('https://media.licdn.com/photo.jpg')
    expect(safeProviderPhotoUrl('https://pbs.twimg.com/photo.jpg', 'x')).toBe('https://pbs.twimg.com/photo.jpg')
    expect(safeProviderPhotoUrl('https://scontent.cdninstagram.com/photo.jpg', 'instagram')).toBe('https://scontent.cdninstagram.com/photo.jpg')
    expect(safeProviderPhotoUrl('https://127.0.0.1/private', 'linkedin')).toBeNull()
  })
})
