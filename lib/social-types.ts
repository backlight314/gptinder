export type SocialPlatform = 'instagram' | 'linkedin' | 'x'

export type NormalizedSocialProfile = {
  platform: SocialPlatform
  externalId: string | null
  handle: string
  name: string
  headline: string | null
  bio: string
  avatarUrl: string | null
  coverImageUrl: string | null
  location: string | null
  followerCount: number | null
  followingCount: number | null
  connectionCount: number | null
  isVerified: boolean
  sourceUrl: string
}

export type NormalizedSocialPost = {
  externalId: string
  url: string | null
  text: string
  kind: string
  imageUrl: string | null
  publishedAt: string | null
  likeCount: number | null
  commentCount: number | null
  viewCount: number | null
  sourceData: Record<string, unknown>
}

export type NormalizedSocialComment = {
  externalId: string
  postExternalId: string
  authorName: string | null
  authorHandle: string | null
  text: string
  publishedAt: string | null
  sourceData: Record<string, unknown>
}

export type NormalizedProfileSection = {
  externalId: string
  kind: string
  heading: string
  text: string
  position: number
  sourceData: Record<string, unknown>
}

export type ProfileImageAsset = {
  sourceUrl: string
  contentType: string
  bytes: Uint8Array
}

export type ImportedPersona = {
  name: string
  handle: string
  traits: string[]
  interests: string[]
  style: string
  bio: string
  color: 'coral' | 'violet'
}

export type SocialImportPayload = {
  provider?: 'apify'
  importMetadata?: Record<string, unknown>
  warnings?: string[]
  profile: NormalizedSocialProfile
  posts: NormalizedSocialPost[]
  comments: NormalizedSocialComment[]
  sections: NormalizedProfileSection[]
  profileImage: ProfileImageAsset | null
  coverImage: ProfileImageAsset | null
  profileSourceData: Record<string, unknown>
  persona: ImportedPersona
}
