import type { Metadata } from 'next'
import AIMatchmaker from '@/components/ai-matchmaker'

export const metadata: Metadata = {
  title: 'AI Lab — Hack the Heart',
  description: 'Preview an owner-reviewed AI-to-AI compatibility conversation.',
}

export default function LabPage() {
  return <AIMatchmaker />
}
