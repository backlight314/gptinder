'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ProfileAnalyzer({ badgeId }: { badgeId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function analyze() {
    setLoading(true)
    setMessage('')
    try {
      const response = await fetch(`/api/airos/profiles/${encodeURIComponent(badgeId)}/analyze`, { method: 'POST' })
      const body = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error || `Analysis failed (${response.status}).`)
      setMessage('Analysis ready.')
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Analysis failed.')
    } finally {
      setLoading(false)
    }
  }

  return <div><button type="button" onClick={analyze} disabled={loading} className="primary-button disabled:opacity-50 disabled:cursor-wait">{loading ? 'Getting to know them…' : 'Analyze profile'}</button>{message && <p aria-live="polite" className="mt-3 text-sm text-muted-foreground">{message}</p>}</div>
}
