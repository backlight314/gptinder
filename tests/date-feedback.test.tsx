import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DateFeedback } from '@/components/ai-matchmaker'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('date feedback controls', () => {
  it('hides Yes/No after no date, records nothing, and lets the question reopen', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<DateFeedback encounterId="enc_test" initialFeedback={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Did you go on a date?' }))
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument()
  })

  it.each([['Yes', 'positive'], ['No', 'negative']])('submits %s date quality only after confirming a date', async (answer, outcome) => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ outcome, status: 'applied' }) })
    vi.stubGlobal('fetch', fetch)
    render(<DateFeedback encounterId="enc_test" initialFeedback={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: answer }))
    await waitFor(() => expect(screen.getByText('Both reaction agents were updated from this report.')).toBeInTheDocument())
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ outcome })
  })

  it('can retry a failed learning update', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ outcome: 'negative', status: 'applied' }) })
    vi.stubGlobal('fetch', fetch)
    render(<DateFeedback encounterId="enc_test" initialFeedback={{ outcome: 'negative', status: 'failed' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry update' }))
    await waitFor(() => expect(screen.getByText('Both reaction agents were updated from this report.')).toBeInTheDocument())
  })
})
