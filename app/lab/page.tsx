import type { Metadata } from 'next'
import AIMatchmaker from '@/components/ai-matchmaker'
import SiteNav from '@/components/site-nav'
import { listLabProfiles } from '@/lib/persona-store'

export const metadata: Metadata = {
  title: 'AI Lab — Hack the Heart',
  description: 'Preview an owner-reviewed AI-to-AI compatibility conversation.',
}

export default async function LabPage({ searchParams }: { searchParams: Promise<{ profileB?: string }> }) {
  const { profileB } = await searchParams
  const selectedProfile = profileB
    ? (await listLabProfiles('b')).find(profile => profile.badgeId === profileB)
    : undefined
  return <><SiteNav /><AIMatchmaker initialProfile={selectedProfile} /></>
}
