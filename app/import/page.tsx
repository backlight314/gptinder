import type { Metadata } from 'next'
import BadgeImporter from '@/components/badge-importer'

export const metadata: Metadata = {
  title: 'Import badge contacts — Hack the Heart',
  description: 'Preview and import official Hack the North Connect contacts over Web Serial.',
}

export default function ImportPage() {
  return <BadgeImporter />
}
