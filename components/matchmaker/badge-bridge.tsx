'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, PlugZap } from 'lucide-react'
import {
  SerialLines,
  canonicalHandshake,
  bumpSchema,
  type BumpEvent,
} from '@/lib/badge-protocol'
import type { MeResponse } from '@/lib/domain'
import { api, Button, Card, ErrorNotice, errorMessage, inputClass } from './ui'

export function BadgeBridge({
  me,
  refresh,
  openEncounter,
}: {
  me: MeResponse
  refresh: () => Promise<void>
  openEncounter: (id: string) => void
}) {
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [profileUrl, setProfileUrl] = useState('')
  const [profileConsent, setProfileConsent] = useState(false)
  const [status, setStatus] = useState(
    'Connect a badge to hear its next hello.',
  )
  const port = useRef<SerialPort | null>(null)
  const reader = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const active = useRef(true)
  const processing = useRef(false)
  const seen = useRef(new Set<string>())
  const queue = useRef<BumpEvent[]>([])
  const storageKey = `gptinder-outbox:${me.user._id}`
  const persistQueue = () => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(queue.current))
    } catch {
      /* B on the badge remains a replay path. */
    }
  }
  const drain = async () => {
    if (processing.current) return
    processing.current = true
    try {
      while (queue.current.length && active.current) {
        const event = queue.current[0]
        const key = canonicalHandshake(event)
        setStatus('Saving your encounter…')
        const result = await api<{ encounterId: string }>(
          '/api/encounters',
          'POST',
          event,
        )
        queue.current.shift()
        persistQueue()
        seen.current.add(key)
        if (seen.current.size > 100)
          seen.current.delete(seen.current.values().next().value!)
        setStatus('Encounter saved. Your representatives can start talking.')
        openEncounter(result.encounterId)
      }
    } catch (e) {
      setError(errorMessage(e))
      setStatus(
        'Encounter retained. Retry delivery below, or press B on the badge.',
      )
    } finally {
      processing.current = false
    }
  }
  const disconnect = async () => {
    await reader.current?.cancel()
    reader.current = null
    if (port.current) {
      try {
        await port.current.close()
      } catch {
        /* Reader loop may still be releasing its lock. */
      }
    }
    port.current = null
    if (active.current) setConnected(false)
  }
  useEffect(() => {
    active.current = true
    try {
      const raw = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]')
      if (Array.isArray(raw))
        queue.current = raw.slice(0, 20).flatMap((value) => {
          const parsed = bumpSchema.safeParse(value)
          return parsed.success ? [parsed.data] : []
        })
    } catch {
      queue.current = []
    }
    return () => {
      active.current = false
      void disconnect()
    }
    // The component is keyed by account, so pending events never cross accounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])
  const connect = async () => {
    setError('')
    if (!('serial' in navigator)) {
      setError(
        'Web Serial requires desktop Chrome or Edge on HTTPS (or localhost).',
      )
      return
    }
    let chosen: SerialPort | undefined
    try {
      chosen = await navigator.serial.requestPort()
      await chosen.open({ baudRate: 115200 })
      port.current = chosen
      setConnected(true)
      setStatus('Listening. Arm both badges with A, then gently bump them.')
      const decoder = new TextDecoder()
      const lines = new SerialLines()
      const streamReader = chosen.readable!.getReader()
      reader.current = streamReader
      try {
        while (active.current) {
          const { value, done } = await streamReader.read()
          if (done) break
          for (const event of lines.push(
            decoder.decode(value, { stream: true }),
          )) {
            const key = canonicalHandshake(event)
            if (
              seen.current.has(key) ||
              queue.current.some((e) => canonicalHandshake(e) === key)
            )
              continue
            if (queue.current.length >= 20) {
              setError(
                'The delivery queue is full. Retry pending encounters before bumping again.',
              )
              continue
            }
            queue.current.push(event)
            persistQueue()
          }
          // Delivery is awaited and queue-backed; no cloud work is abandoned after an API response.
          await drain()
        }
      } finally {
        streamReader.releaseLock()
        reader.current = null
      }
    } catch (e) {
      if (active.current) setError(errorMessage(e))
    } finally {
      if (chosen) {
        try {
          await chosen.close()
        } catch {
          /* Already closed. */
        }
      }
      port.current = null
      if (active.current) setConnected(false)
    }
  }
  const download = async () => {
    setBusy(true)
    setError('')
    try {
      // Load the template before issuing a binding, so a failed asset load consumes no token.
      const response = await fetch('/badge/gptinder.lua')
      if (!response.ok) throw new Error('Could not load the badge app.')
      const template = await response.text()
      if (!template.includes('__DEVICE_TOKEN__'))
        throw new Error('Invalid badge app template.')
      const binding = await api<{ token: string }>('/api/badges', 'POST', {
        profileUrl,
        consent: profileConsent,
      })
      const blob = new Blob(
        [template.replace('__DEVICE_TOKEN__', binding.token)],
        { type: 'text/plain' },
      )
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `gptinder-${me.user.displayName.replace(/[^A-Za-z0-9_-]/g, '_')}.lua`
      link.click()
      URL.revokeObjectURL(url)
      await refresh()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <PlugZap className="text-primary" />
        <h2 className="text-xl font-semibold">A real-world hello</h2>
      </div>
      <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
        Download your paired app and install it through the Badge IDE. Close the
        IDE’s serial connection before connecting here. Each person needs their
        own paired download and public profile link. After a bump, the badges
        elect one sender; connect the badge whose screen says it was elected.
      </p>
      <label className="mb-3 block text-sm">
        Public Instagram, LinkedIn, or X profile
        <input
          className={`${inputClass} mt-1`}
          type="url"
          value={profileUrl}
          maxLength={500}
          onChange={(event) => setProfileUrl(event.target.value)}
          placeholder="https://www.linkedin.com/in/name/"
        />
      </label>
      <label className="mb-5 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={profileConsent}
          onChange={(event) => setProfileConsent(event.target.checked)}
        />
        I own this profile or have permission to import and store its public
        content when my badge meets another badge.
      </label>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={busy || !profileUrl.trim() || !profileConsent}
          variant="secondary"
          onClick={download}
        >
          <Download size={16} />
          {busy ? 'Preparing…' : 'Download my badge app'}
        </Button>
        <Button
          onClick={
            connected
              ? () => {
                  void disconnect()
                }
              : () => {
                  void connect()
                }
          }
        >
          {connected ? 'Disconnect USB' : 'Connect badge via USB'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setError('')
            void drain()
          }}
        >
          Retry pending delivery
        </Button>
      </div>
      <p className="mt-4 text-sm" role="status">
        {status}
      </p>
      <ErrorNotice error={error} />
      <details className="mt-5 text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          Manage paired badges ({me.badges.length})
        </summary>
        {me.badges.map((b) => (
          <div
            key={b._id}
            className="mt-3 flex items-center justify-between gap-3"
          >
            <span>
              {b._id.slice(0, 8)} · expires{' '}
              {new Date(b.expiresAt).toLocaleDateString()}
            </span>
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  await api('/api/badges', 'DELETE', { id: b._id })
                  await refresh()
                } catch (e) {
                  setError(errorMessage(e))
                }
              }}
            >
              Revoke
            </Button>
          </div>
        ))}
      </details>
    </Card>
  )
}
