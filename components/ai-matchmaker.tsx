'use client'

import { useState } from 'react'
import { ArrowRight, Check, ChevronLeft, Database, Heart, Link2, MessageCircle, RefreshCw, Sparkles, Stars, UserRound, Zap } from 'lucide-react'

type PersonKey = 'a' | 'b'
type Persona = {
  name: string
  bio: string
  traits: string[]
  interests: string[]
  style: string
}
type Message = { from: PersonKey; text: string }
type CompatibilityVerdict = {
  score: number
  summary: string
  strengths: string[]
  considerations: string[]
}
type ConversationResponse = {
  messages?: Message[]
  verdicts?: Record<PersonKey, CompatibilityVerdict> | null
  compatibilityScore?: number | null
  verdictUnavailable?: boolean
  error?: string
}
type ImportResponse = {
  userId?: string
  storedProfileCount?: number
  storedPostCount?: number
  storedCommentCount?: number
  error?: string
}
type PersonaSaveResponse = {
  userId?: string
  personaId?: string
  revision?: number
  error?: string
}
type SocialLinks = { linkedin: string; instagram: string; x: string }
type Step = 'landing' | 'profile-a' | 'profile-b' | 'date'

const starterPersonas: Record<PersonKey, Persona> = {
  a: { name: '', bio: '', traits: [], interests: [], style: '' },
  b: { name: '', bio: '', traits: [], interests: [], style: '' },
}

function Logo() {
  return (
    <div className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-8 place-items-center rounded-xl bg-foreground text-background"><Sparkles size={16} /></span>
      <span>AI <span className="text-primary">Matchmaker</span></span>
    </div>
  )
}

function Button({ children, onClick, variant = 'primary', disabled = false, type = 'button' }: { children: React.ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary'; disabled?: boolean; type?: 'button' | 'submit' }) {
  return <button type={type} disabled={disabled} onClick={onClick} className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-all active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-60 ${variant === 'primary' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:brightness-105' : 'border border-border bg-card text-foreground hover:bg-muted'}`}>{children}</button>
}

function Avatar({ person, size = 'md' }: { person: Persona; size?: 'sm' | 'md' | 'lg' }) {
  const classes = size === 'lg' ? 'size-20 text-3xl' : size === 'sm' ? 'size-9 text-sm' : 'size-11 text-base'
  return <div aria-hidden className={`${classes} grid shrink-0 place-items-center rounded-2xl bg-primary/10 font-semibold text-primary`}>{person.name.trim().slice(0, 1).toUpperCase() || '?'}</div>
}

function Stepper({ step }: { step: Step }) {
  const steps: Step[] = ['profile-a', 'profile-b', 'date']
  const current = Math.max(0, steps.indexOf(step))
  return <div aria-label={`Step ${current + 1} of ${steps.length}`} className="flex items-center gap-2 text-xs text-muted-foreground">{steps.map((item, index) => <div className="flex items-center gap-2" key={item}><span className={`grid size-6 place-items-center rounded-full border text-[11px] font-semibold ${index <= current ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'}`}>{index < current ? <Check size={12} /> : index + 1}</span>{index < steps.length - 1 && <span className={`h-px w-6 sm:w-12 ${index < current ? 'bg-primary' : 'bg-border'}`} />}</div>)}</div>
}

function Landing({ start }: { start: () => void }) {
  return <main className="min-h-screen overflow-hidden bg-background"><header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8"><Logo /><span className="hidden rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground sm:block">Private, AI-to-AI simulation</span></header><section className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-12 sm:px-8 lg:grid-cols-[1.05fr_.95fr] lg:gap-20 lg:pb-28 lg:pt-24"><div className="relative z-10"><div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/8 px-3 py-1.5 text-xs font-semibold text-primary"><Stars size={14} /> Personality-led compatibility</div><h1 className="max-w-2xl text-5xl font-semibold leading-[.98] tracking-[-.06em] sm:text-7xl">Explore a first conversation between <span className="text-primary">AI selves.</span></h1><p className="mt-7 max-w-lg text-lg leading-relaxed text-muted-foreground">Review two personality snapshots, then watch a private simulation of how they might talk. Nothing is sent to a dating platform or another person.</p><Button onClick={start}>Create the first profile <ArrowRight size={17} /></Button></div><div className="relative mx-auto w-full max-w-md"><div className="absolute -inset-8 rounded-full bg-primary/15 blur-3xl" /><div className="relative rounded-[2rem] border border-border bg-card p-6 shadow-2xl shadow-foreground/10"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">The compatibility lab</p><p className="mt-2 text-2xl font-semibold">A transparent first hello.</p></div><Zap className="text-primary" /></div><div className="mt-8 flex items-center justify-center gap-5"><div className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary"><UserRound /></div><Heart className="text-primary" fill="currentColor" size={18} /><div className="grid size-16 place-items-center rounded-2xl bg-accent text-accent-foreground"><MessageCircle /></div></div><div className="mt-8 rounded-2xl bg-muted/60 p-4 text-center text-sm text-muted-foreground">Owner-reviewed details in. A contained simulation out.</div></div></div></section></main>
}

function CsvField({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string[]; onChange: (items: string[]) => void }) {
  return <label className="block" htmlFor={id}><span className="text-sm font-semibold">{label}</span><span className="mt-1 block text-xs text-muted-foreground">{hint}</span><input id={id} value={value.join(', ')} onChange={event => onChange(event.target.value.split(',').map(item => item.trim()).filter(Boolean))} className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none ring-primary focus:ring-2" /></label>
}

function ProfilePreview({ persona, user }: { persona: Persona; user: PersonKey }) {
  return <aside className="rounded-3xl border border-primary/20 bg-primary/5 p-5 sm:p-6"><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Stored agent snapshot</p><div className="mt-4 flex items-center gap-3"><Avatar person={persona} size="md" /><div><p className="font-semibold">{persona.name || `Person ${user === 'a' ? 'one' : 'two'}`}</p><p className="text-xs text-muted-foreground">Saved to MongoDB when you confirm this form.</p></div></div><dl className="mt-5 space-y-4 text-sm"><div><dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bio</dt><dd className="mt-1 leading-relaxed">{persona.bio || 'Add a concise description.'}</dd></div><div><dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Traits</dt><dd className="mt-2 flex flex-wrap gap-2">{persona.traits.length ? persona.traits.map(item => <span key={item} className="rounded-full bg-card px-2.5 py-1 text-xs font-medium">{item}</span>) : 'Add traits.'}</dd></div><div><dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Interests</dt><dd className="mt-2 flex flex-wrap gap-2">{persona.interests.length ? persona.interests.map(item => <span key={item} className="rounded-full bg-card px-2.5 py-1 text-xs font-medium">{item}</span>) : 'Add interests.'}</dd></div><div><dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Conversation style</dt><dd className="mt-1 leading-relaxed">{persona.style || 'Describe their voice and pacing.'}</dd></div></dl></aside>
}

function Profile({ user, initial, initialUserId, next, onUserId, back }: { user: PersonKey; initial: Persona; initialUserId?: string; next: (persona: Persona, userId: string) => void; onUserId: (userId: string) => void; back: () => void }) {
  const [persona, setPersona] = useState(initial)
  const [links, setLinks] = useState<SocialLinks>({ linkedin: '', instagram: '', x: '' })
  const [consent, setConsent] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [userId, setUserId] = useState<string | undefined>(initialUserId)
  const isValid = Boolean(persona.name.trim() && persona.bio.trim() && persona.style.trim() && persona.traits.length && persona.interests.length)
  const urls = Object.values(links).map((value) => value.trim()).filter(Boolean)
  const linksNeedImport = urls.length > 0 && !userId
  const change = <K extends keyof Persona>(key: K, value: Persona[K]) => setPersona(current => ({ ...current, [key]: value }))
  const changeLink = (platform: keyof SocialLinks, value: string) => setLinks(current => ({ ...current, [platform]: value }))

  const importProfiles = async () => {
    setImporting(true)
    setImportError('')
    setImportStatus('')
    try {
      const response = await fetch('/api/profiles/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, personaSlot: user, consent, ...(userId ? { userId } : {}) }),
      })
      const data = await response.json().catch(() => ({})) as ImportResponse
      if (!response.ok || !data.userId) {
        throw new Error(data.error ?? 'Unable to import these social profiles.')
      }
      setUserId(data.userId)
      onUserId(data.userId)
      setImportStatus(`Stored ${data.storedProfileCount ?? urls.length} profiles, ${data.storedPostCount ?? 0} posts, and ${data.storedCommentCount ?? 0} comments under ${data.userId}. Re-importing updates these records without duplicates.`)
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : 'Unable to import these social profiles.')
    } finally {
      setImporting(false)
    }
  }

  const savePersona = async () => {
    setSaving(true)
    setSaveError('')
    try {
      const response = await fetch('/api/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: user, persona, ...(userId ? { userId } : {}) }),
      })
      const data = await response.json().catch(() => ({})) as PersonaSaveResponse
      if (!response.ok || !data.userId) throw new Error(data.error ?? 'Unable to save this persona.')
      setUserId(data.userId)
      onUserId(data.userId)
      next(persona, data.userId)
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : 'Unable to save this persona.')
    } finally {
      setSaving(false)
    }
  }

  const canSave = isValid && !saving

  return (
    <main className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
        <button onClick={back} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft size={17} /> Back</button>
        <Logo />
        <Stepper step={user === 'a' ? 'profile-a' : 'profile-b'} />
      </header>
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-6 sm:px-8">
        <div className="mb-8 max-w-2xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[.18em] text-primary">{user === 'a' ? 'Person one' : 'Person two'}</p>
          <h1 className="text-4xl font-semibold tracking-tight">Review {user === 'a' ? 'the first' : 'the second'} personality.</h1>
          <p className="mt-2 text-muted-foreground">Store owner-approved social data in MongoDB. The personality fields stay entirely user-authored.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
          <form onSubmit={event => { event.preventDefault(); if (isValid && !saving) void savePersona() }} className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-8">
            <section className="mb-7 rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><Link2 size={17} /></span>
                <div><h2 className="font-semibold">Store social profiles</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Add one profile per platform. This stores raw profile data, posts, and comments without changing the personality below or creating duplicates.</p></div>
              </div>
              <div className="mt-4 grid gap-3">
                {([
                  ['linkedin', 'LinkedIn profile URL', 'https://www.linkedin.com/in/username'],
                  ['instagram', 'Instagram profile URL', 'https://www.instagram.com/username'],
                  ['x', 'X profile URL', 'https://x.com/username'],
                ] as const).map(([platform, label, placeholder]) => (
                  <label key={platform} htmlFor={`${platform}-${user}`}>
                    <span className="text-xs font-semibold">{label}</span>
                    <input id={`${platform}-${user}`} type="url" value={links[platform]} onChange={event => changeLink(platform, event.target.value)} placeholder={placeholder} className="mt-1.5 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none ring-primary focus:ring-2" />
                  </label>
                ))}
              </div>
              <label className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-0.5 size-4 accent-primary" />
                I own these profiles or have permission to import their public data.
              </label>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button onClick={importProfiles} disabled={!urls.length || !consent || importing}>{importing ? 'Storing profiles…' : 'Store social data'} <Database size={16} /></Button>
                <span className="text-xs text-muted-foreground">{urls.length}/3 links ready</span>
              </div>
              {importStatus && <p role="status" className="mt-4 rounded-xl bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-700 dark:text-emerald-300">{importStatus}</p>}
              {importError && <p role="alert" className="mt-4 rounded-xl bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">{importError}</p>}
            </section>
            <div className="grid gap-5">
              <label htmlFor={`name-${user}`}><span className="text-sm font-semibold">Name</span><input id={`name-${user}`} required maxLength={80} value={persona.name} onChange={event => change('name', event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none ring-primary focus:ring-2" /></label>
              <label htmlFor={`bio-${user}`}><span className="text-sm font-semibold">Bio</span><span className="mt-1 block text-xs text-muted-foreground">A short, factual self-description.</span><textarea id={`bio-${user}`} required maxLength={600} rows={4} value={persona.bio} onChange={event => change('bio', event.target.value)} className="mt-2 w-full resize-y rounded-xl border border-border bg-background p-3 text-sm outline-none ring-primary focus:ring-2" /></label>
              <div className="grid gap-5 sm:grid-cols-2"><CsvField id={`traits-${user}`} label="Traits" hint="Comma-separated, for example: warm, direct" value={persona.traits} onChange={items => change('traits', items)} /><CsvField id={`interests-${user}`} label="Interests" hint="Comma-separated conversation material" value={persona.interests} onChange={items => change('interests', items)} /></div>
              <label htmlFor={`style-${user}`}><span className="text-sm font-semibold">Conversation style</span><span className="mt-1 block text-xs text-muted-foreground">Describe tone, pacing, humor, and message length.</span><textarea id={`style-${user}`} required maxLength={400} rows={3} value={persona.style} onChange={event => change('style', event.target.value)} className="mt-2 w-full resize-y rounded-xl border border-border bg-background p-3 text-sm outline-none ring-primary focus:ring-2" /></label>
            </div>
            {saveError && <p role="alert" className="mt-5 rounded-xl bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">{saveError}</p>}
            {linksNeedImport && <p className="mt-5 rounded-xl bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">Social links are entered but not imported yet. You can save this persona now; use Store social data to attach them to the same user record later.</p>}
            <div className="mt-8 flex justify-end"><Button type="submit" disabled={!canSave}>{saving ? 'Saving persona…' : 'Save persona and continue'} <ArrowRight size={17} /></Button></div>
          </form>
          <ProfilePreview persona={persona} user={user} />
        </div>
      </div>
    </main>
  )
}

function VerdictCard({ person, verdict }: { person: Persona; verdict: CompatibilityVerdict }) {
  return <article className="rounded-2xl border border-border bg-card p-5"><div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><Avatar person={person} size="sm" /><div><h3 className="text-sm font-semibold">{person.name}&apos;s agent</h3><p className="text-xs text-muted-foreground">Simulated perspective</p></div></div><div className="rounded-xl bg-primary/10 px-3 py-2 text-center text-primary"><span className="block text-xl font-semibold leading-none">{verdict.score}</span><span className="mt-1 block text-[10px] font-semibold uppercase tracking-wider">score</span></div></div><p className="mt-4 text-sm leading-relaxed">{verdict.summary}</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Strengths</p><ul className="mt-2 space-y-1.5 text-xs leading-relaxed">{verdict.strengths.map(item => <li className="flex gap-2" key={item}><Check className="mt-0.5 shrink-0 text-primary" size={13} /><span>{item}</span></li>)}</ul></div>{verdict.considerations.length > 0 && <div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Considerations</p><ul className="mt-2 space-y-1.5 text-xs leading-relaxed">{verdict.considerations.map(item => <li className="flex gap-2" key={item}><span className="mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground" /><span>{item}</span></li>)}</ul></div>}</div></article>
}

function DateView({ profiles, back }: { profiles: Record<PersonKey, Persona>; back: () => void }) {
  const [conversation, setConversation] = useState<Message[]>([])
  const [verdicts, setVerdicts] = useState<Record<PersonKey, CompatibilityVerdict> | null>(null)
  const [compatibilityScore, setCompatibilityScore] = useState<number | null>(null)
  const [verdictUnavailable, setVerdictUnavailable] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const startConversation = async () => {
    setLoading(true)
    setError('')
    setConversation([])
    setVerdicts(null)
    setCompatibilityScore(null)
    setVerdictUnavailable(false)
    try {
      const response = await fetch('/api/match/conversation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ participants: profiles, turns: 6 }) })
      const data = await response.json().catch(() => ({})) as ConversationResponse
      if (!response.ok || !data.messages) throw new Error(data.error ?? 'Unable to start the conversation.')
      setConversation(data.messages)
      setVerdicts(data.verdicts ?? null)
      setCompatibilityScore(typeof data.compatibilityScore === 'number' ? data.compatibilityScore : null)
      setVerdictUnavailable(Boolean(data.verdictUnavailable))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start the conversation.')
    } finally {
      setLoading(false)
    }
  }

  return <main className="min-h-screen bg-background"><header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8"><button onClick={back} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft size={17} /> Profiles</button><Logo /><Stepper step="date" /></header><div className="mx-auto max-w-3xl px-5 pb-12 sm:px-8"><div className="mb-7 text-center"><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">The first conversation</p><h1 className="mt-2 text-4xl font-semibold tracking-tight">Let&apos;s see how they talk.</h1><p className="mt-2 text-muted-foreground">A private, AI-to-AI simulation. The reviewed persona snapshots are stored in MongoDB; conversation messages are generated for this run.</p></div><div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div className="flex items-center gap-3"><Avatar person={profiles.a} size="sm" /><div className="text-xs"><b>{profiles.a.name}&apos;s agent</b><span className="mx-2 text-muted-foreground">&amp;</span><b>{profiles.b.name}&apos;s agent</b></div></div><span className="text-xs text-muted-foreground">{conversation.length} / 6 turns</span></div><div aria-live="polite" className="min-h-[390px] space-y-4 bg-gradient-to-b from-muted/35 to-background p-5 sm:p-8">{!conversation.length && !loading && <div className="grid min-h-[330px] place-items-center text-center text-sm text-muted-foreground">Start a six-turn simulation using the two reviewed snapshots and server-side credentials.</div>}{loading && <div className="grid min-h-[330px] place-items-center text-center text-sm text-muted-foreground"><span className="animate-pulse">The agents are getting acquainted, then reflecting on the exchange…</span></div>}{conversation.map((message, index) => <div key={`${message.from}-${index}`} className={`flex items-end gap-2 ${message.from === 'b' ? 'flex-row-reverse' : ''}`}><Avatar person={profiles[message.from]} size="sm" /><div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.from === 'a' ? 'rounded-bl-md bg-primary/10' : 'rounded-br-md bg-accent'}`}>{message.text}</div></div>)}{conversation.length > 0 && <section className="mt-8 border-t border-border pt-8"><div className="mx-auto max-w-lg text-center"><div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"><Heart fill="currentColor" size={13} /> Conversation compatibility</div><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Two independent AI perspectives on this single simulated exchange—not a prediction of real-world compatibility.</p></div>{verdicts && compatibilityScore !== null && <><div className="mx-auto mt-5 grid size-32 place-items-center rounded-full border-8 border-primary/15 bg-card text-center shadow-sm"><div><div className="text-4xl font-semibold tracking-[-.06em] text-primary">{compatibilityScore}</div><div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">combined score</div></div></div><div className="mt-6 grid gap-4">{(['a', 'b'] as PersonKey[]).map(person => <VerdictCard key={person} person={profiles[person]} verdict={verdicts[person]} />)}</div></>}{verdictUnavailable && <p role="status" className="mt-6 rounded-2xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">The conversation is ready, but the compatibility verdict was unavailable for this run. Run another simulation to try again.</p>}</section>}{error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}</div><div className="flex justify-start border-t border-border px-5 py-4"><Button variant="secondary" onClick={startConversation} disabled={loading}>{loading ? 'Generating…' : conversation.length ? 'Run another simulation' : 'Start simulation'} {conversation.length ? <RefreshCw size={15} /> : <Sparkles size={15} />}</Button></div></div></div></main>
}

export default function AIMatchmaker() {
  const [step, setStep] = useState<Step>('landing')
  const [profiles, setProfiles] = useState<Record<PersonKey, Persona>>(starterPersonas)
  const [userIds, setUserIds] = useState<Partial<Record<PersonKey, string>>>({})
  const saveProfile = (user: PersonKey) => (persona: Persona, _userId: string) => {
    setProfiles(current => ({ ...current, [user]: persona }))
    setUserIds(current => ({ ...current, [user]: _userId }))
    setStep(user === 'a' ? 'profile-b' : 'date')
  }
  const rememberUserId = (user: PersonKey) => (userId: string) => {
    setUserIds(current => ({ ...current, [user]: userId }))
  }
  if (step === 'landing') return <Landing start={() => setStep('profile-a')} />
  if (step === 'profile-a') return <Profile key="profile-a" user="a" initial={profiles.a} initialUserId={userIds.a} next={saveProfile('a')} onUserId={rememberUserId('a')} back={() => setStep('landing')} />
  if (step === 'profile-b') return <Profile key="profile-b" user="b" initial={profiles.b} initialUserId={userIds.b} next={saveProfile('b')} onUserId={rememberUserId('b')} back={() => setStep('profile-a')} />
  return <DateView profiles={profiles} back={() => setStep('profile-b')} />
}

export type { Persona }
