import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import BadgeImporter, { BadgeConsole } from './badge-importer'

afterEach(cleanup)

describe('BadgeImporter', () => {
  it('shows a clear unsupported-browser state without Web Serial', () => {
    render(<BadgeImporter />)
    expect(screen.getByText(/Unsupported browser/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /connect badge/i })).toBeInTheDocument()
  })

  it('discloses read-only access and public contact behavior', () => {
    render(<BadgeImporter />)
    expect(screen.getByText(/Read-only badge access/i)).toBeInTheDocument()
    expect(screen.getByText(/email and phone—are public/i)).toBeInTheDocument()
  })
})

describe('BadgeConsole', () => {
  it('reassembles fragmented command output through the prompt and releases locks', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    const readable = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
    const writable = new WritableStream<Uint8Array>({
      write() {
        controller.enqueue(encoder.encode('cat /littlefs/identity'))
        controller.enqueue(encoder.encode('.json\r\n{"badge_id":"test"}\r\n'))
        controller.enqueue(encoder.encode('badge>'))
      },
    })
    const session = new BadgeConsole(readable, writable, 100)
    await expect(session.command('cat /littlefs/identity.json')).resolves.toContain('{"badge_id":"test"}')
    await session.close()
    expect(readable.locked).toBe(false)
    expect(writable.locked).toBe(false)
  })

  it('times out an incomplete read and still permits cleanup', async () => {
    const readable = new ReadableStream<Uint8Array>()
    const writable = new WritableStream<Uint8Array>()
    const session = new BadgeConsole(readable, writable, 10)
    await expect(session.command('ls /littlefs/config/contacts')).rejects.toThrow(/did not finish/i)
    await session.close()
    expect(readable.locked).toBe(false)
    expect(writable.locked).toBe(false)
  })

  it('accepts a badge response that does not echo the command', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    const readable = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
    const writable = new WritableStream<Uint8Array>({
      write() {
        controller.enqueue(encoder.encode('{"badge_id":"quiet-badge-test-star"}\r\nbadge>'))
      },
    })
    const session = new BadgeConsole(readable, writable, 100)
    await expect(session.command('cat /littlefs/identity.json')).resolves.toContain('quiet-badge-test-star')
    await session.close()
  })

  it('wakes a newly connected badge with a blank line before reading commands', async () => {
    let written = ''
    const readable = new ReadableStream<Uint8Array>()
    const writable = new WritableStream<Uint8Array>({ write(value) { written += new TextDecoder().decode(value) } })
    const session = new BadgeConsole(readable, writable, 20)
    await session.wake()
    expect(written).toBe('\r')
    await session.close()
  })
})
