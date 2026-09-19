'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AIROS_MAX_CONTACTS,
  importBatchFromSerial,
  parseContactListing,
  type BadgeImportBatch,
  type ImportSummary,
  type PreviewRecord,
} from '@/lib/airos-directory'

type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
}

type SerialNavigator = Navigator & {
  serial?: { requestPort(options: { filters: Array<{ usbVendorId: number; usbProductId: number }> }): Promise<SerialPortLike> }
}

type PreviewResponse = { ownerBadgeId: string; records: PreviewRecord[]; error?: string }

const COMMAND_TIMEOUT_MS = 6_000
const MAX_COMMAND_OUTPUT = 128 * 1024

export class BadgeConsole {
  private reader: ReadableStreamDefaultReader<Uint8Array>
  private writer: WritableStreamDefaultWriter<Uint8Array>
  private decoder = new TextDecoder()
  private encoder = new TextEncoder()
  private buffer = ''
  private readError: Error | null = null
  private stopped = false
  private readLoop: Promise<void>

  constructor(
    readable: ReadableStream<Uint8Array>,
    writable: WritableStream<Uint8Array>,
    private readonly commandTimeoutMs = COMMAND_TIMEOUT_MS,
  ) {
    this.reader = readable.getReader()
    this.writer = writable.getWriter()
    this.readLoop = this.consume()
  }

  private async consume() {
    try {
      while (!this.stopped) {
        const result = await this.reader.read()
        if (result.done) break
        this.buffer += this.decoder.decode(result.value, { stream: true })
        if (this.buffer.length > MAX_COMMAND_OUTPUT * 2) this.buffer = this.buffer.slice(-MAX_COMMAND_OUTPUT)
      }
    } catch (error) {
      if (!this.stopped) this.readError = error instanceof Error ? error : new Error('The badge disconnected.')
    }
  }

  async drain() {
    let previous = -1
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      if (this.buffer.length === previous) break
      previous = this.buffer.length
    }
    this.buffer = ''
  }

  private async once(command: string) {
    this.buffer = ''
    await this.writer.write(this.encoder.encode(`${command}\r`))
    const started = Date.now()
    while (Date.now() - started < this.commandTimeoutMs) {
      if (this.readError) throw this.readError
      if (this.buffer.length > MAX_COMMAND_OUTPUT) throw new Error('The badge returned more data than the importer accepts.')
      const normalized = this.buffer.replace(/\r\n?/g, '\n')
      const echoIndex = normalized.indexOf(command)
      const promptIndex = normalized.indexOf('badge>', Math.max(0, echoIndex + command.length))
      if (echoIndex >= 0 && promptIndex >= 0) return normalized.slice(echoIndex + command.length, promptIndex)
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`The badge did not finish “${command}” in time.`)
  }

  async command(command: string) {
    try {
      return await this.once(command)
    } catch (firstError) {
      if (this.readError) throw firstError
      await this.drain()
      return this.once(command)
    }
  }

  async close() {
    this.stopped = true
    try { await this.reader.cancel() } catch { /* Port may already be disconnected. */ }
    try { await this.readLoop } catch { /* consume stores readable errors */ }
    this.reader.releaseLock()
    this.writer.releaseLock()
  }
}

function browserError(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'Badge selection was cancelled.'
  if (error instanceof DOMException && error.name === 'InvalidStateError') return 'The badge serial port is already open in another tab or app.'
  if (error instanceof DOMException && error.name === 'NetworkError') return 'The badge port could not be opened. Reconnect it with a USB data cable and close other serial tools.'
  if (error instanceof Error) return error.message
  return 'The badge could not be read.'
}

async function responseJson<T>(response: Response) {
  const body = await response.json().catch(() => null) as T & { error?: string } | null
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status}).`)
  if (!body) throw new Error('The server returned an empty response.')
  return body
}

export default function BadgeImporter() {
  const [phase, setPhase] = useState<'idle' | 'reading' | 'previewing' | 'ready' | 'importing' | 'done'>('idle')
  const [message, setMessage] = useState('Connect an official Hack the North badge with a USB data cable.')
  const [batch, setBatch] = useState<BadgeImportBatch | null>(null)
  const [records, setRecords] = useState<PreviewRecord[]>([])
  const [invalid, setInvalid] = useState<string[]>([])
  const [result, setResult] = useState<ImportSummary | null>(null)
  const supported = typeof navigator !== 'undefined' && 'serial' in navigator
  const counts = useMemo(() => records.reduce<Record<string, number>>((all, record) => {
    all[record.status] = (all[record.status] || 0) + 1
    return all
  }, {}), [records])

  async function connectAndPreview() {
    if (!supported) {
      setMessage('Web Serial is not available here. Use desktop Chrome, Brave, or Edge over HTTPS.')
      return
    }
    setPhase('reading')
    setMessage('Choose the Espressif badge port. Hack the Heart will only read identity and contact files.')
    setBatch(null)
    setRecords([])
    setInvalid([])
    setResult(null)
    let port: SerialPortLike | null = null
    let consoleSession: BadgeConsole | null = null
    try {
      port = await (navigator as SerialNavigator).serial!.requestPort({
        filters: [{ usbVendorId: 0x303a, usbProductId: 0x1001 }],
      })
      await port.open({ baudRate: 115200 })
      if (!port.readable || !port.writable) throw new Error('The selected port is not readable and writable. Check that the cable supports data.')
      consoleSession = new BadgeConsole(port.readable, port.writable)
      await consoleSession.drain()
      const identityOutput = await consoleSession.command('cat /littlefs/identity.json')
      const listingOutput = await consoleSession.command('ls /littlefs/config/contacts')
      const files = parseContactListing(listingOutput)
      if (files.length > AIROS_MAX_CONTACTS) throw new Error(`The badge has more than ${AIROS_MAX_CONTACTS} contact files, which exceeds the import limit.`)
      const contactOutputs: Array<{ file: string; output: string }> = []
      for (const file of files) {
        setMessage(`Reading contact ${contactOutputs.length + 1} of ${files.length}…`)
        contactOutputs.push({
          file,
          output: await consoleSession.command(`cat /littlefs/config/contacts/${file}`),
        })
      }
      const parsed = importBatchFromSerial(identityOutput, contactOutputs)
      if (!parsed.batch) throw new Error('The owner identity could not be parsed from this badge.')
      setInvalid(parsed.invalid)
      setBatch(parsed.batch)
      setPhase('previewing')
      setMessage('Checking what the import would change…')
      const preview = await responseJson<PreviewResponse>(await fetch('/api/airos/imports/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.batch),
      }))
      setRecords(preview.records)
      setPhase('ready')
      setMessage(`Preview ready: ${preview.records.length} valid profile${preview.records.length === 1 ? '' : 's'}. Nothing has been uploaded yet.`)
    } catch (error) {
      setPhase('idle')
      setMessage(browserError(error))
    } finally {
      if (consoleSession) await consoleSession.close()
      if (port) {
        try { await port.close() } catch { /* Already disconnected or closed. */ }
      }
    }
  }

  async function importAll() {
    if (!batch || phase !== 'ready') return
    setPhase('importing')
    setMessage('Importing the previewed profiles…')
    try {
      const summary = await responseJson<ImportSummary>(await fetch('/api/airos/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      }))
      setResult(summary)
      setRecords(summary.profiles)
      setPhase('done')
      setMessage('Import complete. The badge was read only; no badge files or settings were changed.')
    } catch (error) {
      setPhase('ready')
      setMessage(error instanceof Error ? error.message : 'Upload failed.')
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-10 sm:px-8">
      <nav className="mb-12 flex items-center justify-between">
        <Link href="/" className="text-xl font-black tracking-tight">Hack the Heart</Link>
        <Link href="/lab" className="text-sm text-muted-foreground hover:text-foreground">AI Lab</Link>
      </nav>
      <section className="max-w-3xl">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary">Official Connect importer</p>
        <h1 className="text-4xl font-black tracking-tight sm:text-6xl">Bring your badge contacts into Hack the Heart.</h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">Desktop Chrome, Brave, or Edge can read the owner and saved contacts over USB-C. You preview every result before anything is added to the public directory.</p>
      </section>
      <section className="mt-10 rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={connectAndPreview} disabled={phase === 'reading' || phase === 'previewing' || phase === 'importing'} className="rounded-full bg-primary px-6 py-3 font-bold text-primary-foreground disabled:opacity-50">
            {phase === 'reading' ? 'Reading badge…' : 'Connect badge'}
          </button>
          {phase === 'ready' && <button type="button" onClick={importAll} className="rounded-full border border-primary px-6 py-3 font-bold text-primary">Import all</button>}
          <p aria-live="polite" className="min-w-0 flex-1 text-sm text-muted-foreground">{message}</p>
        </div>
        {!supported && <p className="mt-4 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">Unsupported browser. Web Serial requires a supported desktop Chromium browser and a secure HTTPS page.</p>}
        {records.length > 0 && (
          <div className="mt-8">
            <div className="mb-4 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-700">{counts.new || 0} new</span>
              <span className="rounded-full bg-blue-500/10 px-3 py-1 text-blue-700">{counts.fills_missing || 0} fill missing</span>
              <span className="rounded-full bg-muted px-3 py-1">{counts.existing || 0} unchanged</span>
              <span className="rounded-full bg-amber-500/10 px-3 py-1 text-amber-700">{counts.conflict || 0} conflict</span>
              {invalid.length > 0 && <span className="rounded-full bg-destructive/10 px-3 py-1 text-destructive">{invalid.length} invalid</span>}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {records.map((record) => <article key={record.badgeId} className="rounded-2xl border p-4">
                <div className="flex items-start justify-between gap-3"><div><h2 className="font-bold">{record.name}</h2><p className="font-mono text-xs text-muted-foreground">{record.badgeId}</p></div><span className="rounded-full bg-muted px-2 py-1 text-[11px] font-semibold">{record.status.replace('_', ' ')}</span></div>
                {record.fills.length > 0 && <p className="mt-3 text-xs text-blue-700">Fills: {record.fills.join(', ')}</p>}
                {record.conflicts.length > 0 && <p className="mt-2 text-xs text-amber-700">Kept existing: {record.conflicts.join(', ')}</p>}
                {phase === 'done' && <Link href={record.profileUrl} className="mt-3 inline-block text-sm font-semibold text-primary">View profile →</Link>}
              </article>)}
            </div>
          </div>
        )}
        {result && <p className="mt-6 rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-800">Added {result.newProfiles}, filled {result.updatedProfiles}, kept {result.existingProfiles}, and recorded {result.connections} connections.</p>}
      </section>
      <aside className="mt-6 rounded-2xl border border-dashed p-5 text-sm leading-6 text-muted-foreground"><strong className="text-foreground">Read-only badge access.</strong> Hack the Heart only sends the three documented <code>cat</code>/<code>ls</code> command shapes. It does not flash, reboot, configure, or write to the badge. Imported profiles—including email and phone—are public and marked badge-imported.</aside>
    </main>
  )
}
