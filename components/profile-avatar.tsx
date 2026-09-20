'use client'

import { useState } from 'react'
import { UserRound } from 'lucide-react'

export default function ProfileAvatar({ name, src, alternatives = [], large = false }: { name: string; src?: string | null; alternatives?: string[]; large?: boolean }) {
  const [failedSources, setFailedSources] = useState<string[]>([])
  const activeSource = [src, ...alternatives].find((url): url is string => Boolean(url) && !failedSources.includes(url!))
  return <div className={`profile-avatar ${large ? 'profile-avatar-large' : ''}`}>
    {activeSource ? <img key={activeSource} src={activeSource} alt={`${name}'s profile photo`} width={large ? 144 : 56} height={large ? 144 : 56} referrerPolicy="no-referrer" loading={large ? 'eager' : 'lazy'} onError={() => setFailedSources(previous => [...previous, activeSource])} /> : <span role="img" aria-label={`${name}, default profile photo`}><UserRound size={large ? 76 : 30} strokeWidth={1.25} /></span>}
  </div>
}
