'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw, X } from 'lucide-react'

export default function DemoReset() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  function close() {
    if (loading) return
    setOpen(false)
    setConfirmation('')
    setMessage('')
  }

  async function reset(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    try {
      const response = await fetch('/api/airos/demo-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation }),
      })
      const body = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error || `Reset failed (${response.status}).`)
      setMessage('Demo data cleared. The directory is ready for a fresh import.')
      setConfirmation('')
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The demo reset failed.')
    } finally {
      setLoading(false)
    }
  }

  return <>
    <button type="button" className="demo-reset-link" onClick={() => setOpen(true)}><RotateCcw size={13} /> Reset demo data</button>
    {open && <div className="reset-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <section className="reset-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title">
        <button type="button" className="reset-close" aria-label="Close reset dialog" onClick={close}><X size={17} /></button>
        <div className="reset-icon"><RotateCcw size={21} /></div>
        <h2 id="reset-title">Start a clean demo?</h2>
        <p>This permanently removes every imported badge profile, connection, observation, analysis, and badge-linked social record.</p>
        <form onSubmit={reset}>
          <label><span>Type <strong>RESET</strong> to confirm</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" required pattern="RESET" /></label>
          <div className="reset-actions"><button type="button" onClick={close} disabled={loading}>Cancel</button><button type="submit" className="reset-danger" disabled={loading || confirmation !== 'RESET'}>{loading ? 'Clearing…' : 'Delete badge data'}</button></div>
        </form>
        {message && <p className="reset-message" aria-live="polite">{message}</p>}
      </section>
    </div>}
  </>
}
