'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Heart, LogOut, Sparkles, Stars } from 'lucide-react'
import type { Encounter, MeResponse, PreferenceVersion } from '@/lib/domain'
import {
  api,
  Avatar,
  Button,
  Card,
  ErrorNotice,
  errorMessage,
  inputClass,
  Logo,
} from './ui'
import { Onboarding } from './onboarding'
import { BadgeBridge } from './badge-bridge'
import { Conversation } from './conversation'
import { Imports } from './imports'
import { EmailSignIn } from './email-signin'

export default function AIMatchmaker() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [encounterId, setEncounterId] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    setMe(await api<MeResponse>('/api/me'))
  }, [])
  useEffect(() => {
    let active = true
    fetch('/api/me', { cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 401) return
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        if (active) setMe(data)
      })
      .catch((e) => {
        if (active) setError(errorMessage(e))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    const sync = () =>
      setEncounterId(new URLSearchParams(location.search).get('encounter'))
    sync()
    window.addEventListener('popstate', sync)
    return () => {
      active = false
      window.removeEventListener('popstate', sync)
    }
  }, [])
  const openEncounter = (id: string | null) => {
    const url = new URL(location.href)
    if (id) url.searchParams.set('encounter', id)
    else url.searchParams.delete('encounter')
    history.pushState({}, '', url)
    setEncounterId(id)
  }
  if (loading)
    return (
      <main className="grid min-h-screen place-content-center bg-background">
        <Logo />
        <p className="mt-4 text-sm text-muted-foreground">
          Restoring your place…
        </p>
      </main>
    )
  if (!me) return <Welcome initialError={error} onSignedIn={refresh} />
  return (
    <main className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6 sm:px-8">
        <Logo />
        <div className="flex items-center gap-3 text-sm">
          <span>
            {me.user.displayName}
            {me.user.demo ? ' · demo account' : ''}
          </span>
          <Button
            aria-label="Sign out"
            variant="ghost"
            onClick={async () => {
              try {
                await api('/api/auth', 'DELETE')
                setMe(null)
                openEncounter(null)
              } catch (e) {
                setError(errorMessage(e))
              }
            }}
          >
            <LogOut size={16} />
          </Button>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-5 pb-20 pt-5 sm:px-8">
        <ErrorNotice error={error} />
        {!me.profile ? (
          <Onboarding me={me} refresh={refresh} />
        ) : encounterId ? (
          <Conversation
            key={encounterId}
            id={encounterId}
            me={me}
            refresh={refresh}
            back={() => openEncounter(null)}
          />
        ) : (
          <Dashboard me={me} refresh={refresh} openEncounter={openEncounter} />
        )}
      </div>
    </main>
  )
}

function Welcome({
  onSignedIn,
  initialError,
}: {
  onSignedIn: () => Promise<void>
  initialError: string
}) {
  const [form, setForm] = useState(false)
  const [login, setLogin] = useState(false)
  const [demoRegister, setDemoRegister] = useState(false)
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [adult, setAdult] = useState(false)
  const [accessKey, setAccessKey] = useState('')
  const [error, setError] = useState(initialError)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      if (demoRegister) {
        const result = await api<{ accessKey: string }>('/api/auth', 'POST', {
          action: 'register',
          displayName: name.trim(),
          adult,
        })
        setAccessKey(result.accessKey)
      } else {
        await api('/api/auth', 'POST', {
          action: 'login',
          accessKey: key.trim(),
        })
        await onSignedIn()
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="min-h-screen overflow-hidden bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
        <Logo />
        <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
          Your profile, reviewed by you
        </span>
      </header>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-12 sm:px-8 lg:grid-cols-[1.05fr_.95fr] lg:gap-20 lg:py-24">
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/8 px-3 py-1.5 text-xs font-semibold text-primary">
            <Stars size={14} />
            Compatibility, with a little curiosity
          </div>
          <h1 className="text-5xl font-semibold leading-[.98] tracking-[-.06em] sm:text-7xl">
            Let your <span className="text-primary">AI selves</span> go on the
            first date.
          </h1>
          <p className="my-7 max-w-lg text-lg leading-relaxed text-muted-foreground">
            Build a personality snapshot, let your representatives chat, and
            explore what matters to you before saying hello.
          </p>
          <Button
            onClick={() => {
              setForm(true)
              setLogin(false)
            }}
          >
            Get started
            <ArrowRight size={17} />
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setForm(true)
              setLogin(true)
            }}
          >
            I have a sign-in key
          </Button>
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute -inset-8 rounded-full bg-primary/15 blur-3xl" />
          <Card className="relative">
            {!form ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">
                  The compatibility lab
                </p>
                <h2 className="mt-2 text-2xl font-semibold">
                  A better first hello.
                </h2>
                <div className="my-9 flex items-center justify-center gap-5">
                  <Avatar seed="hello-one" large />
                  <Heart
                    className="text-primary"
                    fill="currentColor"
                    size={20}
                  />
                  <Avatar seed="hello-two" large />
                </div>
                <p className="rounded-2xl bg-muted p-4 text-center text-sm text-muted-foreground">
                  Your preferences. A real conversation. Room to learn.
                </p>
              </>
            ) : !login ? (
              <>
                <EmailSignIn onSignedIn={onSignedIn} />
                <Button
                  className="mt-4"
                  variant="ghost"
                  onClick={() => setLogin(true)}
                >
                  Use a demo sign-in key
                </Button>
              </>
            ) : accessKey ? (
              <>
                <h2 className="text-2xl font-semibold">Save your demo key</h2>
                <p className="my-4 text-sm text-muted-foreground">
                  This key is shown once. Save it before continuing.
                </p>
                <code className="block break-all rounded-xl bg-muted p-4 text-sm">
                  {accessKey}
                </code>
                <Button
                  className="mt-4"
                  variant="secondary"
                  onClick={() => navigator.clipboard.writeText(accessKey)}
                >
                  Copy key
                </Button>
                <Button className="mt-4" onClick={() => void onSignedIn()}>
                  I saved it — continue
                </Button>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void submit()
                }}
              >
                <h2 className="mb-5 text-2xl font-semibold">
                  {demoRegister
                    ? 'Create local demo account.'
                    : 'Welcome back.'}
                </h2>
                {demoRegister ? (
                  <>
                    <label className="text-sm font-semibold">
                      Display name
                      <input
                        className={`${inputClass} my-3`}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={60}
                        required
                      />
                    </label>
                    <label className="my-4 flex gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={adult}
                        onChange={(e) => setAdult(e.target.checked)}
                        required
                      />
                      I am 18 or older.
                    </label>
                  </>
                ) : (
                  <label className="text-sm font-semibold">
                    Existing demo sign-in key
                    <input
                      autoComplete="off"
                      type="password"
                      className={`${inputClass} my-3`}
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      maxLength={64}
                      required
                    />
                  </label>
                )}
                <Button type="submit" disabled={busy}>
                  {busy
                    ? 'Connecting…'
                    : demoRegister
                      ? 'Create demo account'
                      : 'Sign in'}
                  <Sparkles size={16} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setLogin(false)
                    setDemoRegister(false)
                  }}
                >
                  Use email sign-in / recovery
                </Button>
                {!demoRegister && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setDemoRegister(true)}
                  >
                    Create a new local demo account
                  </Button>
                )}
              </form>
            )}
            <ErrorNotice error={error} />
          </Card>
        </div>
      </section>
    </main>
  )
}

function Dashboard({
  me,
  refresh,
  openEncounter,
}: {
  me: MeResponse
  refresh: () => Promise<void>
  openEncounter: (id: string) => void
}) {
  const [encounters, setEncounters] = useState<Encounter[]>([])
  const [versions, setVersions] = useState<PreferenceVersion[]>([])
  const [error, setError] = useState('')
  const [revertTarget, setRevertTarget] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    Promise.all([
      api<Encounter[]>('/api/encounters'),
      api<PreferenceVersion[]>('/api/preferences'),
    ])
      .then(([e, v]) => {
        if (active) {
          setEncounters(e)
          setVersions(v)
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e))
      })
    return () => {
      active = false
    }
  }, [me.preferences?._id])
  const profile = me.profile!
  return (
    <>
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">
          Your compatibility lab
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">
          Ready for a better hello.
        </h1>
      </div>
      <ErrorNotice error={error} />
      <div className="grid items-start gap-6 lg:grid-cols-[.85fr_1.15fr]">
        <div className="space-y-6">
          <Card>
            <div className="mb-5 flex items-center gap-5">
              <Avatar seed={profile.avatarSeed} large />
              <div>
                <h2 className="text-2xl font-semibold">
                  {me.user.displayName}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Approved profile · preference version{' '}
                  {me.preferences?.version}
                </p>
              </div>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
              {profile.shareable.traits.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
                >
                  {t}
                </span>
              ))}
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {profile.shareable.summary}
            </p>
            <p className="mt-4 text-sm">
              <b>Conversation style:</b> {profile.shareable.style}
            </p>
            <p className="mt-3 text-sm">
              <b>Interests:</b>{' '}
              {profile.shareable.interests.join(', ') || 'Not specified'}
            </p>
          </Card>
          <Imports refresh={refresh} allowCreate={false} />
          <Card>
            <h2 className="text-xl font-semibold">Preference history</h2>
            <p className="my-3 text-sm text-muted-foreground">
              A confirmed lesson creates a new version. Reverting also creates a
              new version.
            </p>
            {versions.map((v) => (
              <div
                key={v._id}
                className="mt-3 flex items-center justify-between gap-2 text-sm"
              >
                <span>
                  Version {v.version}
                  {v._id === me.preferences?._id ? ' · current' : ''}
                </span>
                {v._id !== me.preferences?._id && (
                  <Button
                    variant="ghost"
                    onClick={() => setRevertTarget(v._id)}
                  >
                    Revert to this
                  </Button>
                )}
              </div>
            ))}
            {revertTarget && (
              <div className="mt-4 rounded-xl bg-muted p-4">
                <p className="mb-3 text-sm">
                  Create a new version using these earlier preferences?
                </p>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await api('/api/preferences', 'PATCH', {
                        targetId: revertTarget,
                        expectedId: me.preferences?._id,
                        confirmed: true,
                      })
                      setRevertTarget('')
                      await refresh()
                    } catch (e) {
                      setError(errorMessage(e))
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  Confirm revert
                </Button>
                <Button variant="ghost" onClick={() => setRevertTarget('')}>
                  Cancel
                </Button>
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <BadgeBridge
            key={me.user._id}
            me={me}
            refresh={refresh}
            openEncounter={openEncounter}
          />
          <Card>
            <h2 className="mb-4 text-xl font-semibold">Your encounters</h2>
            {encounters.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Your first badge hello will appear here.
              </p>
            ) : (
              encounters.map((e) => (
                <button
                  key={e._id}
                  onClick={() => openEncounter(e._id)}
                  className="mb-3 flex w-full items-center justify-between rounded-2xl border border-border p-4 text-left transition-colors hover:bg-muted"
                >
                  <span>
                    <b className="text-sm">
                      {
                        e.participants.find((p) => p.userId !== me.user._id)
                          ?.name
                      }
                    </b>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString()} ·{' '}
                      {e.status.replace('_', ' ')}
                    </span>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
