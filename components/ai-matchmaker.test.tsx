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
  prefilled: true,
  owned: true,
} as const

it('loads stored profiles, selects one, and keeps URL import available', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ profiles: [storedProfile] }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)

  render(<AIMatchmaker />)
  fireEvent.click(screen.getByRole('button', { name: /create the first profile/i }))

  expect(await screen.findByText('Stored Person')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /stored person.*use this profile/i }))
  expect(screen.getByDisplayValue('Stored Person')).toBeInTheDocument()
  expect(screen.getByDisplayValue('Likes long walks and board games.')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByText(/Prefilled only from reviewed public profile data and social activity/)).toBeInTheDocument())
  expect(screen.getByDisplayValue('curious')).toBeInTheDocument()
  expect(screen.getByText('curious · board games')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /save selected profile/i })).toBeEnabled()

  fireEvent.click(screen.getByRole('button', { name: /import a different profile from urls/i }))
  await waitFor(() => expect(screen.getByText('Store social profiles')).toBeInTheDocument())
  expect(screen.getByPlaceholderText('https://www.linkedin.com/in/username')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith('/api/personas?slot=a', { cache: 'no-store' })
})

it('lets Person One edit and save another stored profile', async () => {
  const readOnlyProfile = { ...storedProfile, owned: false }
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ userId: readOnlyProfile.userId }), { status: 200 }))
    return Promise.resolve(new Response(JSON.stringify({ profiles: [readOnlyProfile] }), { status: 200 }))
  })
  vi.stubGlobal('fetch', fetchMock)

  render(<AIMatchmaker />)
  fireEvent.click(screen.getByRole('button', { name: /create the first profile/i }))
  expect(await screen.findByText('Stored Person')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /stored person.*use this profile/i }))

  expect(screen.getByLabelText('Name')).not.toBeDisabled()
  expect(screen.getByRole('button', { name: /save selected profile and continue/i })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: /save selected profile and continue/i }))
  const postCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
  expect(JSON.parse(String((postCall?.[1] as RequestInit).body))).toMatchObject({ userId: readOnlyProfile.userId })
})

it('allows Person One to author a blank stored profile', async () => {
  const blankProfile = { ...storedProfile, name: 'Blank Contact', bio: '', traits: [], interests: [], style: '', prefilled: false, owned: false }
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ userId: 'usr_new_persona' }), { status: 200 }))
    return Promise.resolve(new Response(JSON.stringify({ profiles: [blankProfile] }), { status: 200 }))
  })
  vi.stubGlobal('fetch', fetchMock)

  render(<AIMatchmaker />)
  fireEvent.click(screen.getByRole('button', { name: /create the first profile/i }))
  expect(await screen.findByText('Blank Contact')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /blank contact.*use this profile/i }))

  expect(screen.getByLabelText('Name')).not.toBeDisabled()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My authored profile' } })
  fireEvent.change(screen.getByLabelText(/Bio/), { target: { value: 'A factual bio.' } })
  fireEvent.change(screen.getByLabelText(/Traits/), { target: { value: 'curious' } })
  fireEvent.change(screen.getByLabelText(/Interests/), { target: { value: 'design' } })
  fireEvent.change(screen.getByLabelText(/Conversation style/), { target: { value: 'Concise and direct.' } })
  fireEvent.click(screen.getByRole('button', { name: /save selected profile and continue/i }))

  const postCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
  expect(postCall).toBeDefined()
  expect(JSON.parse(String((postCall?.[1] as RequestInit).body))).toMatchObject({ userId: blankProfile.userId })
})

it('lets Person Two edit and save a selected stored profile', async () => {
  const personTwoProfile = { ...storedProfile, name: 'Person Two Profile', userId: 'usr_person_two', owned: false }
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ userId: storedProfile.userId }), { status: 200 }))
    const url = String(input)
    return Promise.resolve(new Response(JSON.stringify({ profiles: url.includes('slot=b') ? [personTwoProfile] : [storedProfile] }), { status: 200 }))
  })
  vi.stubGlobal('fetch', fetchMock)

  render(<AIMatchmaker />)
  fireEvent.click(screen.getByRole('button', { name: /create the first profile/i }))
  expect(await screen.findByText('Stored Person')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /stored person.*use this profile/i }))
  fireEvent.click(screen.getByRole('button', { name: /save selected profile and continue/i }))

  expect(await screen.findByText(/Person two from your stored profiles/i)).toBeInTheDocument()
  expect(await screen.findByText('Person Two Profile')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /person two profile.*use this profile/i }))
  expect(screen.getByLabelText('Name')).not.toBeDisabled()
  expect(screen.getByRole('button', { name: /save selected profile and continue/i })).toBeEnabled()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Edited Person Two' } })
  fireEvent.click(screen.getByRole('button', { name: /save selected profile and continue/i }))

  const postCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
  expect(JSON.parse(String((postCalls.at(-1)?.[1] as RequestInit).body))).toMatchObject({ slot: 'b', userId: personTwoProfile.userId })
})
