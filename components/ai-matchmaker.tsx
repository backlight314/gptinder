'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Check, ChevronLeft, Database, Heart, Link2, ListOrdered, MessageCircle, RefreshCw, Sparkles, Stars, ThumbsDown, ThumbsUp, UserRound, Zap } from 'lucide-react'

type PersonKey = 'a' | 'b'
type Persona = {
  name: string
  bio: string
  traits: string[]
  interests: string[]
  style: string
  values: string[]
  lifeGoals: {
    wantChildren: 'yes' | 'no' | 'unsure' | 'not_disclosed'
    relationshipType: 'monogamous' | 'non_monogamous' | 'unsure' | 'not_disclosed'
  }
  relationshipPreferences: {
    planning: 'planned' | 'flexible' | 'spontaneous' | 'not_disclosed'
    communication: 'frequent' | 'balanced' | 'space' | 'not_disclosed'
  }
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
type Step = 'landing' | 'profile-a' | 'profile-b' | 'date' | 'log'

const starterPersonas: Record<PersonKey, Persona> = {
  a: { name: '', bio: '', traits: [], interests: [], style: '', values: [], lifeGoals: { wantChildren: 'not_disclosed', relationshipType: 'not_disclosed' }, relationshipPreferences: { planning: 'not_disclosed', communication: 'not_disclosed' } },
  b: { name: '', bio: '', traits: [], interests: [], style: '', values: [], lifeGoals: { wantChildren: 'not_disclosed', relationshipType: 'not_disclosed' }, relationshipPreferences: { planning: 'not_disclosed', communication: 'not_disclosed' } },
}

function Logo() {
  return (
    <div className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-8 place-items-center rounded-xl bg-foreground text-background"><Sparkles size={16} /></span>
      <span><span className="text-primary">Hack the Heart</span> Lab</span>
    </div>
  )
}

function Button({ children, onClick, variant = 'primary', disabled = false, type = 'button' }: { children: React.ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary'; disabled?: boolean; type?: 'button' | 'submit' }) {
  return <button type={type} disabled={disabled} onClick={onClick} className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-all active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-60 ${variant === 'primary' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:brightness-105' : 'border border-border bg-card text-foreground hover:bg-muted'}`}>{children}</button>
}

function Avatar({ person, size = 'md' }: { person: { name: string }; size?: 'sm' | 'md' | 'lg' }) {
  const classes = size === 'lg' ? 'size-20 text-3xl' : size === 'sm' ? 'size-9 text-sm' : 'size-11 text-base'
  return <div aria-hidden className={`${classes} grid shrink-0 place-items-center rounded-2xl bg-primary/10 font-semibold text-primary`}>{person.name.trim().slice(0, 1).toUpperCase() || '?'}</div>
}

function Stepper({ step }: { step: Step }) {
  const steps: Step[] = ['profile-a', 'profile-b', 'date']
  const current = Math.max(0, steps.indexOf(step))
  return <div aria-label={`Step ${current + 1} of ${steps.length}`} className="flex items-center gap-2 text-xs text-muted-foreground">{steps.map((item, index) => <div className="flex items-center gap-2" key={item}><span className={`grid size-6 place-items-center rounded-full border text-[11px] font-semibold ${index <= current ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'}`}>{index < current ? <Check size={12} /> : index + 1}</span>{index < steps.length - 1 && <span className={`h-px w-6 sm:w-12 ${index < current ? 'bg-primary' : 'bg-border'}`} />}</div>)}</div>
}

function Landing({ start, log }: { start: () => void; log: () => void }) {
  return <main className="min-h-screen overflow-hidden bg-background"><header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8"><Logo /><button onClick={log} className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"><ListOrdered size={14} /> Conversation log</button></header><section className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-12 sm:px-8 lg:grid-cols-[1.05fr_.95fr] lg:gap-20 lg:pb-28 lg:pt-24"><div className="relative z-10"><div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/8 px-3 py-1.5 text-xs font-semibold text-primary"><Stars size={14} /> Hack the Heart compatibility lab</div><h1 className="max-w-2xl text-5xl font-semibold leading-[.98] tracking-[-.06em] sm:text-7xl">Explore a first conversation between <span className="text-primary">AI selves.</span></h1><p className="mt-7 max-w-lg text-lg leading-relaxed text-muted-foreground">Review two personality snapshots, then watch a private simulation of how they might talk. Nothing is sent to a dating platform or another person.</p><Button onClick={start}>Create the first profile <ArrowRight size={17} /></Button></div><div className="relative mx-auto w-full max-w-md"><div className="absolute -inset-8 rounded-full bg-primary/15 blur-3xl" /><div className="relative rounded-[2rem] border border-border bg-card p-6 shadow-2xl shadow-foreground/10"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">The Hack the Heart lab</p><p className="mt-2 text-2xl font-semibold">A transparent first hello.</p></div><Zap className="text-primary" /></div><div className="mt-8 flex items-center justify-center gap-5"><div className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary"><UserRound /></div><Heart className="text-primary" fill="currentColor" size={18} /><div className="grid size-16 place-items-center rounded-2xl bg-accent text-accent-foreground"><MessageCircle /></div></div><div className="mt-8 rounded-2xl bg-muted/60 p-4 text-center text-sm text-muted-foreground">Owner-reviewed details in. A contained simulation out.</div></div></div></section></main>
}

function CsvField({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string[]; onChange: (items: string[]) => void }) {
  const [draft, setDraft] = useState(() => value.join(', '))
  const parse = (input: string) => input.split(',').map(item => item.trim()).filter(Boolean)

  return <label className="block" htmlFor={id}><span className="text-sm font-semibold">{label}</span><span className="mt-1 block text-xs text-muted-foreground">{hint}</span><input id={id} value={draft} onChange={event => { setDraft(event.target.value); onChange(parse(event.target.value)) }} onBlur={() => { const items = parse(draft); setDraft(items.join(', ')); onChange(items) }} className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none ring-primary focus:ring-2" /></label>
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
  const isValid = Boolean(persona.name.trim() && persona.bio.trim() && persona.style.trim() && persona.traits.length && persona.interests.length && persona.values.length)
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
              <CsvField id={`values-${user}`} label="Personal values" hint="Explicit values, for example: benevolence, achievement" value={persona.values} onChange={items => change('values', items)} />
              <fieldset className="rounded-2xl border border-border p-4">
                <legend className="px-2 text-sm font-semibold">Confirmed goals and preferences</legend>
                <p className="mb-4 text-xs leading-relaxed text-muted-foreground">Choose only answers this person has explicitly approved. Unknown answers stay undisclosed.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-semibold">Children<select value={persona.lifeGoals.wantChildren} onChange={event => change('lifeGoals', { ...persona.lifeGoals, wantChildren: event.target.value as Persona['lifeGoals']['wantChildren'] })} className="mt-2 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal"><option value="not_disclosed">Not disclosed</option><option value="yes">Wants children</option><option value="no">Does not want children</option><option value="unsure">Unsure</option></select></label>
                  <label className="text-xs font-semibold">Relationship type<select value={persona.lifeGoals.relationshipType} onChange={event => change('lifeGoals', { ...persona.lifeGoals, relationshipType: event.target.value as Persona['lifeGoals']['relationshipType'] })} className="mt-2 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal"><option value="not_disclosed">Not disclosed</option><option value="monogamous">Monogamous</option><option value="non_monogamous">Non monogamous</option><option value="unsure">Unsure</option></select></label>
                  <label className="text-xs font-semibold">Planning style<select value={persona.relationshipPreferences.planning} onChange={event => change('relationshipPreferences', { ...persona.relationshipPreferences, planning: event.target.value as Persona['relationshipPreferences']['planning'] })} className="mt-2 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal"><option value="not_disclosed">Not disclosed</option><option value="planned">Planned</option><option value="flexible">Flexible</option><option value="spontaneous">Spontaneous</option></select></label>
                  <label className="text-xs font-semibold">Communication rhythm<select value={persona.relationshipPreferences.communication} onChange={event => change('relationshipPreferences', { ...persona.relationshipPreferences, communication: event.target.value as Persona['relationshipPreferences']['communication'] })} className="mt-2 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal"><option value="not_disclosed">Not disclosed</option><option value="frequent">Frequent</option><option value="balanced">Balanced</option><option value="space">More space</option></select></label>
                </div>
              </fieldset>
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

type AgentMessage = { _id: string; sequence: number; speakerKey: PersonKey; action: string; text: string; voicePromptId?: string }
type Interpretation = {
  literalMeaning: string
  possibleIntent: string
  fourLensAnalysis: {
    behavior: { signal: string }
    interpersonal: { messageWarmth: string; messageDominance: string; signal: string }
    attachmentRegulation: { possibleActivation: string; reason: string }
    values: { relevantPreferences: string[]; signal: string }
  }
  possibleUserReaction: { state: string; strength: string }
  recommendedApproach: string
  uncertainty: string
}
type AgentReaction = { _id: string; inputMessageId: string; ownerUserId: string; interpretation: Interpretation }
type AppCompatibility = { label: string; score: number | null; coverage: number; features: Array<{ key: string; outcome: string; detail: string }> }
type EncounterResponse = {
  encounterId?: string
  status?: 'pending_start' | 'running' | 'complete' | 'failed'
  messages?: AgentMessage[]
  reactions?: AgentReaction[]
  compatibility?: AppCompatibility | null
  error?: string
}

function InterpretationCard({ reaction, ownerName }: { reaction: AgentReaction; ownerName: string }) {
  const analysis = reaction.interpretation.fourLensAnalysis
  return <aside className="mx-11 rounded-2xl border border-primary/20 bg-primary/5 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">{ownerName}&apos;s AI Interpretation</p><p className="mt-1 text-xs text-muted-foreground">Possible reaction with {reaction.interpretation.uncertainty} uncertainty</p></div><span className="rounded-full bg-card px-2.5 py-1 text-xs font-semibold">{reaction.interpretation.recommendedApproach.replaceAll('_', ' ')}</span></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div><b className="text-xs">Behaviour</b><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{analysis.behavior.signal}</p></div><div><b className="text-xs">Interpersonal</b><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{analysis.interpersonal.signal}</p></div><div><b className="text-xs">Emotion and regulation</b><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{analysis.attachmentRegulation.reason}</p></div><div><b className="text-xs">Values and preferences</b><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{analysis.values.signal}</p></div></div></aside>
}

type LogParticipant = { key: PersonKey; userId: string; name: string }
type EncounterFeedback = { outcome: 'positive' | 'negative'; status: string; error?: string | null }
type StoredAdaptationView = {
  userId: string
  version: number
  resolvedBias: string
  guidance: string
  confidence: string
  outcomeTally: { positive: number; negative: number }
  cues: Array<{ cue: string; direction: string; reason: string }>
}
type EncounterSummary = {
  encounterId: string
  status: string
  createdAt: string | null
  participants: LogParticipant[]
  messageCount: number
  compatibility: { label: string; score: number | null } | null
  feedback: EncounterFeedback | null
}
type EncounterDetail = EncounterResponse & {
  participants?: LogParticipant[]
  feedback?: EncounterFeedback | null
  adaptations?: StoredAdaptationView[]
}

const outcomeLabel: Record<string, string> = { positive: 'Date went well', negative: 'Date went poorly' }

export function DateFeedback({ encounterId, initialFeedback, onApplied }: { encounterId: string; initialFeedback: EncounterFeedback | null; onApplied?: () => void }) {
  const [feedback, setFeedback] = useState(initialFeedback)
  const [askingQuality, setAskingQuality] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { setFeedback(initialFeedback) }, [initialFeedback])
  useEffect(() => {
    if (feedback?.status !== 'pending' && feedback?.status !== 'learning') return
    let active = true
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/match/conversation/${encounterId}`, { cache: 'no-store' })
        const body = await response.json() as EncounterDetail
        if (!response.ok || !active) return
        setFeedback(body.feedback ?? null)
        setError('')
        if (body.feedback?.status === 'applied') onApplied?.()
      } catch {
        if (active) setError('Connection interrupted. Retrying the update status…')
      }
    }, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [encounterId, feedback, onApplied])

  const submit = async (outcome: 'positive' | 'negative') => {
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/match/conversation/${encounterId}/feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome }),
      })
      const body = await response.json().catch(() => ({})) as { error?: string; outcome?: 'positive' | 'negative'; status?: string }
      if (!response.ok) throw new Error(body.error ?? 'The date report could not be saved.')
      setAskingQuality(false)
      setFeedback({ outcome: body.outcome ?? outcome, status: body.status ?? 'pending' })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The date report could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  if (feedback) return <section className="mt-8 rounded-2xl border border-border bg-card p-5"><p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Confirmed outcome</p><p className="mt-2 text-sm font-semibold">{outcomeLabel[feedback.outcome] ?? feedback.outcome}</p><p className="mt-1 text-xs text-muted-foreground">{feedback.status === 'applied' ? 'Both reaction agents were updated from this report.' : feedback.status === 'failed' ? feedback.error ?? 'The update could not be applied.' : 'Updating both reaction agents from this report…'}</p>{feedback.status === 'failed' && <Button variant="secondary" disabled={saving} onClick={() => submit(feedback.outcome)}>Retry update</Button>}{error && <p role="alert">{error}</p>}</section>

  return <section className="mt-8 rounded-2xl border border-border bg-card p-5"><p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Post date report</p>{askingQuality ? <><p className="mt-2 text-sm font-semibold">Did the date go well?</p><p className="mt-1 text-xs text-muted-foreground">This confirmed answer is the only thing that changes how each reaction agent weights similar messages later.</p><div className="mt-4 flex gap-2"><Button onClick={() => submit('positive')} disabled={saving}>Yes <ThumbsUp size={15} /></Button><Button variant="secondary" onClick={() => submit('negative')} disabled={saving}>No <ThumbsDown size={15} /></Button></div></> : <><button className="mt-2 text-sm font-semibold" onClick={() => setDismissed(false)}>Did you go on a date?</button>{!dismissed && <div className="mt-4 flex gap-2"><Button onClick={() => { setDismissed(false); setAskingQuality(true) }} disabled={saving}>Yes</Button><Button variant="secondary" onClick={() => setDismissed(true)} disabled={saving}>No</Button></div>}</>}{error && <p role="alert" className="mt-3 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">{error}</p>}</section>
}

function AdaptationCard({ adaptation, ownerName }: { adaptation: StoredAdaptationView; ownerName: string }) {
  return <aside className="rounded-2xl border border-primary/20 bg-primary/5 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">{ownerName}&apos;s reaction agent, version {adaptation.version}</p><p className="mt-1 text-xs text-muted-foreground">{adaptation.outcomeTally.positive} good and {adaptation.outcomeTally.negative} poor dates confirmed so far, {adaptation.confidence} confidence</p></div><span className="rounded-full bg-card px-2.5 py-1 text-xs font-semibold">{adaptation.resolvedBias.replaceAll('_', ' ')}</span></div><p className="mt-3 text-xs leading-relaxed text-muted-foreground">{adaptation.guidance}</p><ul className="mt-3 space-y-1">{adaptation.cues.map(cue => <li className="text-xs text-muted-foreground" key={`${cue.cue}-${cue.direction}`}><b className="text-foreground">{cue.cue}</b> ({cue.direction}): {cue.reason}</li>)}</ul></aside>
}

function LogEncounterView({ encounterId, back }: { encounterId: string; back: () => void }) {
  const [detail, setDetail] = useState<EncounterDetail | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/match/conversation/${encounterId}`, { cache: 'no-store' })
      const body = await response.json().catch(() => ({})) as EncounterDetail
      if (!response.ok) throw new Error(body.error ?? 'The conversation could not be loaded.')
      setDetail(body)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The conversation could not be loaded.')
    }
  }, [encounterId])

  useEffect(() => { void load() }, [load])

  const participants = detail?.participants ?? []
  const nameFor = (value: string) => participants.find(item => item.userId === value || item.key === value)?.name ?? value
  const messages = detail?.messages ?? []
  const reactions = detail?.reactions ?? []

  return <main className="min-h-screen bg-background"><header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8"><button onClick={back} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft size={17} /> Conversation log</button><Logo /><span className="hidden text-xs text-muted-foreground sm:block">{detail?.status?.replaceAll('_', ' ') ?? 'loading'}</span></header><div className="mx-auto max-w-3xl px-5 pb-12 sm:px-8">{error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}{!detail && !error && <p className="text-sm text-muted-foreground">Loading the conversation…</p>}{detail && <><div className="mb-7"><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Stored conversation</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{participants.map(item => item.name).join(' and ')}</h1><p className="mt-2 text-sm text-muted-foreground">{messages.length} stored messages and {reactions.length} private interpretations.</p></div><div className="space-y-4 rounded-3xl border border-border bg-card p-5 sm:p-8">{messages.map(message => { const reaction = reactions.find(item => item.inputMessageId === message._id); return <div className="space-y-4" key={message._id}><div className={`flex items-end gap-2 ${message.speakerKey === 'b' ? 'flex-row-reverse' : ''}`}><Avatar person={{ name: nameFor(message.speakerKey) }} size="sm" /><div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.speakerKey === 'a' ? 'rounded-bl-md bg-primary/10' : 'rounded-br-md bg-accent'}`}><p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{message.action.replaceAll('_', ' ')}</p>{message.text}</div></div>{reaction && <InterpretationCard reaction={reaction} ownerName={nameFor(reaction.ownerUserId)} />}</div> })}{detail.status === 'complete' && <DateFeedback encounterId={encounterId} initialFeedback={detail.feedback ?? null} onApplied={load} />}{Boolean(detail.adaptations?.length) && <section className="mt-8 space-y-3 border-t border-border pt-8"><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">What the system learned</p>{detail.adaptations?.map(adaptation => <AdaptationCard key={`${adaptation.userId}-${adaptation.version}`} adaptation={adaptation} ownerName={nameFor(adaptation.userId)} />)}</section>}</div></>}</div></main>
}

function ConversationLog({ back, open }: { back: () => void; open: (encounterId: string) => void }) {
  const [encounters, setEncounters] = useState<EncounterSummary[] | null>(null)
  const [offset, setOffset] = useState(0)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/match/conversations?offset=${offset}`, { cache: 'no-store' })
      const body = await response.json().catch(() => ({})) as { encounters?: EncounterSummary[]; nextOffset?: number | null; error?: string }
      if (!response.ok) throw new Error(body.error ?? 'The conversation log could not be loaded.')
      setEncounters(body.encounters ?? [])
      setNextOffset(body.nextOffset ?? null)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The conversation log could not be loaded.')
    }
  }, [offset])

  useEffect(() => { void load() }, [load])

  return <main className="min-h-screen bg-background"><header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8"><button onClick={back} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft size={17} /> Home</button><Logo /><button onClick={() => { setEncounters(null); void load() }} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><RefreshCw size={15} /> Refresh</button></header><div className="mx-auto max-w-4xl px-5 pb-12 sm:px-8"><div className="mb-7"><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Every stored conversation</p><h1 className="mt-2 text-4xl font-semibold tracking-tight">Conversation log.</h1><p className="mt-2 text-muted-foreground">Every simulation on this deployment, not only the profiles created in this browser. Open one to read it and report whether a real date followed.</p></div>{error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}{!encounters && !error && <p className="text-sm text-muted-foreground">Loading the conversation log…</p>}{encounters?.length === 0 && <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">No conversations have been stored yet.</p>}<div className="space-y-3">{encounters?.map(encounter => <button key={encounter.encounterId} onClick={() => open(encounter.encounterId)} className="flex w-full items-center justify-between gap-4 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted"><div className="flex items-center gap-3"><Avatar person={{ name: encounter.participants[0]?.name ?? '?' }} size="sm" /><div><p className="text-sm font-semibold">{encounter.participants.map(item => item.name).join(' and ')}</p><p className="mt-1 text-xs text-muted-foreground">{encounter.messageCount} messages, {encounter.status.replaceAll('_', ' ')}{encounter.createdAt ? ` on ${new Date(encounter.createdAt).toLocaleDateString()}` : ''}</p></div></div><div className="flex items-center gap-3">{encounter.feedback && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${encounter.feedback.outcome === 'positive' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>{outcomeLabel[encounter.feedback.outcome]}</span>}{encounter.compatibility?.score !== null && encounter.compatibility && <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">{encounter.compatibility.score}</span>}<ArrowRight className="text-muted-foreground" size={16} /></div></button>)}</div><nav aria-label="Conversation pages" className="mt-5 flex gap-3"><Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Newer</Button><Button variant="secondary" disabled={nextOffset === null} onClick={() => setOffset(nextOffset ?? offset)}>Older</Button></nav></div></main>
}

function DateView({ profiles, userIds, openLog, back }: { profiles: Record<PersonKey, Persona>; userIds: Partial<Record<PersonKey, string>>; openLog: () => void; back: () => void }) {
  const [result, setResult] = useState<EncounterDetail>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const startConversation = async () => {
    if (!userIds.a || !userIds.b) return setError('Save both profiles before starting the simulation.')
    setLoading(true)
    setError('')
    setResult({})
    try {
      const response = await fetch('/api/match/conversation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participants: { a: { userId: userIds.a }, b: { userId: userIds.b } }, turns: 6 }),
      })
      const started = await response.json().catch(() => ({})) as EncounterDetail
      if (!response.ok || !started.encounterId) throw new Error(started.error ?? 'Unable to start the conversation.')
      for (let attempt = 0; attempt < 180; attempt += 1) {
        const currentResponse = await fetch(`/api/match/conversation/${started.encounterId}`, { cache: 'no-store' })
        const current = await currentResponse.json().catch(() => ({})) as EncounterDetail
        if (!currentResponse.ok) throw new Error(current.error ?? 'Unable to load the conversation.')
        setResult(current)
        if (current.status === 'complete') return
        if (current.status === 'failed') throw new Error(current.error ?? 'The conversation workflow failed.')
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      throw new Error('The conversation is still running. Try again shortly.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start the conversation.')
    } finally {
      setLoading(false)
    }
  }

  const messages = result.messages ?? []
  const reactions = result.reactions ?? []
  const nameForUser = (userId: string) => userId === userIds.a ? profiles.a.name : profiles.b.name

  return <main className="min-h-screen bg-background"><header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8"><button onClick={back} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft size={17} /> Profiles</button><Logo /><div className="flex items-center gap-4"><button onClick={openLog} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ListOrdered size={15} /> Log</button><Stepper step="date" /></div></header><div className="mx-auto max-w-3xl px-5 pb-12 sm:px-8"><div className="mb-7 text-center"><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">The first conversation</p><h1 className="mt-2 text-4xl font-semibold tracking-tight">Let&apos;s see how they talk.</h1><p className="mt-2 text-muted-foreground">Watch the conversation and each AI’s possible reactions, then report how the date went.</p></div><div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div className="flex items-center gap-3"><Avatar person={profiles.a} size="sm" /><div className="text-xs"><b>{profiles.a.name}</b><span className="mx-2 text-muted-foreground">and</span><b>{profiles.b.name}</b></div></div><span className="text-xs text-muted-foreground">{messages.length} / 6 turns</span></div><div aria-live="polite" className="min-h-[390px] space-y-4 bg-gradient-to-b from-muted/35 to-background p-5 sm:p-8">{!messages.length && !loading && <div className="grid min-h-[330px] place-items-center text-center text-sm text-muted-foreground">Start a six-turn conversation using the reviewed profiles and writing styles.</div>}{loading && !messages.length && <div className="grid min-h-[330px] place-items-center text-center text-sm text-muted-foreground"><span className="animate-pulse">The agents are getting acquainted…</span></div>}{messages.map(message => { const reaction = reactions.find(item => item.inputMessageId === message._id); return <div className="space-y-4" key={message._id}><div className={`flex items-end gap-2 ${message.speakerKey === 'b' ? 'flex-row-reverse' : ''}`}><Avatar person={profiles[message.speakerKey]} size="sm" /><div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.speakerKey === 'a' ? 'rounded-bl-md bg-primary/10' : 'rounded-br-md bg-accent'}`}><p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{message.action.replaceAll('_', ' ')}{message.voicePromptId ? ' · voice grounded' : ''}</p>{message.text}</div></div>{reaction && <InterpretationCard reaction={reaction} ownerName={nameForUser(reaction.ownerUserId)} />}</div>})}{result.status === 'complete' && result.compatibility && <section className="mt-8 border-t border-border pt-8"><div className="text-center"><div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"><Heart fill="currentColor" size={13} /> {result.compatibility.label}</div><p className="mt-3 text-sm text-muted-foreground">Deterministic rules use confirmed goals and preferences. This score is not a probability of relationship success.</p>{result.compatibility.score === null ? <p className="mt-5 text-sm font-semibold">Insufficient confirmed evidence</p> : <div className="mx-auto mt-5 grid size-28 place-items-center rounded-full border-8 border-primary/15 bg-card text-4xl font-semibold text-primary">{result.compatibility.score}</div>}</div><div className="mt-6 grid gap-2">{result.compatibility.features.map(feature => <div key={feature.key} className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-3 text-xs"><span className="font-semibold capitalize">{feature.key.replaceAll(/([A-Z])/g, ' $1')}</span><span className="max-w-[70%] text-right text-muted-foreground">{feature.detail}</span></div>)}</div></section>}{result.status === 'complete' && result.encounterId && <DateFeedback encounterId={result.encounterId} initialFeedback={result.feedback ?? null} />}{error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}</div><div className="flex items-center justify-between border-t border-border px-5 py-4"><span className="text-xs text-muted-foreground">{loading ? `Workflow ${result.status?.replaceAll('_', ' ') ?? 'starting'}` : result.status === 'complete' ? 'Complete' : 'Ready'}</span><Button variant="secondary" onClick={startConversation} disabled={loading}>{loading ? 'Running…' : messages.length ? 'Run another simulation' : 'Start simulation'} {messages.length ? <RefreshCw size={15} /> : <Sparkles size={15} />}</Button></div></div></div></main>
}

export default function AIMatchmaker() {
  const [step, setStep] = useState<Step>('landing')
  const [profiles, setProfiles] = useState<Record<PersonKey, Persona>>(starterPersonas)
  const [userIds, setUserIds] = useState<Partial<Record<PersonKey, string>>>({})
  const [openEncounterId, setOpenEncounterId] = useState<string | null>(null)
  const saveProfile = (user: PersonKey) => (persona: Persona, _userId: string) => {
    setProfiles(current => ({ ...current, [user]: persona }))
    setUserIds(current => ({ ...current, [user]: _userId }))
    setStep(user === 'a' ? 'profile-b' : 'date')
  }
  const rememberUserId = (user: PersonKey) => (userId: string) => {
    setUserIds(current => ({ ...current, [user]: userId }))
  }
  const openLog = () => {
    setOpenEncounterId(null)
    setStep('log')
  }
  if (step === 'log' && openEncounterId) return <LogEncounterView encounterId={openEncounterId} back={() => setOpenEncounterId(null)} />
  if (step === 'log') return <ConversationLog back={() => setStep('landing')} open={setOpenEncounterId} />
  if (step === 'landing') return <Landing start={() => setStep('profile-a')} log={openLog} />
  if (step === 'profile-a') return <Profile key="profile-a" user="a" initial={profiles.a} initialUserId={userIds.a} next={saveProfile('a')} onUserId={rememberUserId('a')} back={() => setStep('landing')} />
  if (step === 'profile-b') return <Profile key="profile-b" user="b" initial={profiles.b} initialUserId={userIds.b} next={saveProfile('b')} onUserId={rememberUserId('b')} back={() => setStep('profile-a')} />
  return <DateView profiles={profiles} userIds={userIds} openLog={openLog} back={() => setStep('profile-b')} />
}

export type { Persona }
