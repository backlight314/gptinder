'use client'

import { useState } from 'react'
import { profileInitials } from '@/lib/profile-photo'

export default function ProfileAvatar({ name, src, alternatives = [], large = false }: { name: string; src?: string | null; alternatives?: string[]; large?: boolean }) {
  const [failedSources, setFailedSources] = useState<string[]>([])
  const activeSource = [src, ...alternatives].find((url): url is string => Boolean(url) && !failedSources.includes(url!))
  return <div className={`profile-avatar ${large ? 'profile-avatar-large' : ''}`}>
    {activeSource ? <img key={activeSource} src={activeSource} alt={`${name}'s profile photo`} width={large ? 144 : 56} height={large ? 144 : 56} referrerPolicy="no-referrer" loading={large ? 'eager' : 'lazy'} onError={() => setFailedSources(previous => [...previous, activeSource])} /> : <span className="avatar-initials" role="img" aria-label={`${name}, default profile photo`}>{profileInitials(name)}</span>}
  </div>
}
