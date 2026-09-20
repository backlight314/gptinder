import type { Metadata } from 'next'
import AIMatchmaker from '@/components/ai-matchmaker'
import SiteNav from '@/components/site-nav'

export const metadata: Metadata = {
  title: 'AI Lab — Hack the Heart',
  description: 'Preview an owner-reviewed AI-to-AI compatibility conversation.',
}

export default function LabPage() {
  return <><SiteNav /><AIMatchmaker /></>
}
