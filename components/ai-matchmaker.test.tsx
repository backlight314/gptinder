import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AIMatchmaker from './ai-matchmaker'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const storedProfile = {
  name: 'Stored Person',
  bio: 'Likes long walks and board games.',
  traits: ['curious'],
  interests: ['board games'],
  style: 'Warm and direct.',
  values: ['fairness'],
  lifeGoals: { wantChildren: 'not_disclosed', relationshipType: 'not_disclosed' },
  relationshipPreferences: { planning: 'not_disclosed', communication: 'not_disclosed' },
  userId: 'usr_stored_person',
  badgeId: 'stored-person-badge',
  role: 'Builder',
  avatarUrl: null,
  source: 'badge_import',
} as const

it('loads stored profiles, selects one, and keeps URL import available', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ profiles: [storedProfile] }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)

  render(<AIMatchmaker />)
  fireEvent.click(screen.getByRole('button', { name: /create the first profile/i }))

  expect(await screen.findByText('Stored Person')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Stored Person'))
  expect(screen.getByDisplayValue('Stored Person')).toBeInTheDocument()
  expect(screen.getByDisplayValue('Likes long walks and board games.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /save selected profile/i })).toBeEnabled()

  fireEvent.click(screen.getByRole('button', { name: /import a different profile from urls/i }))
  await waitFor(() => expect(screen.getByText('Store social profiles')).toBeInTheDocument())
  expect(screen.getByPlaceholderText('https://www.linkedin.com/in/username')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith('/api/personas?slot=a', { cache: 'no-store' })
})
