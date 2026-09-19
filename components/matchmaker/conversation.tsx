'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Pause, Play } from 'lucide-react'
import type {
  DateFeedback,
  EncounterResponse,
  MeResponse,
  PreferenceUpdate,
} from '@/lib/domain'
import { DIMENSION_LABELS } from '@/lib/domain'
import {
  api,
  ApiError,
  Avatar,
  Button,
  Card,
  ErrorNotice,
  errorMessage,
  inputClass,
} from './ui'

export function Conversation({
  id,
  me,
  back,
  refresh,
}: {
  id: string
  me: MeResponse
  back: () => void
  refresh: () => Promise<void>
}) {
  const [data, setData] = useState<EncounterResponse | null>(null)
  const [error, setError] = useState('')
  const [count, setCount] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    let lastRecovery = 0
    const poll = async () => {
      try {
        const next = await api<EncounterResponse>(`/api/encounters/${id}`)
        if (!active) return
        setData(next)
        setError('')
        if (
          next.encounter.status === 'complete' ||
          next.encounter.status === 'failed'
        )
          return
        if (Date.now() - lastRecovery > 65000) {
          lastRecovery = Date.now()
          await api(`/api/encounters/${id}`, 'POST')
        }
        if (active) timer = setTimeout(poll, document.hidden ? 5000 : 1000)
      } catch (e) {
        if (active) {
          setError(errorMessage(e))
          if (
            e instanceof ApiError &&
            [401, 403, 404, 410].includes(e.status)
          ) {
            setData(null)
            return
          }
          timer = setTimeout(poll, 5000)
        }
      }
    }
    void poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [id, retry])
  useEffect(() => {
    if (!playing || count >= (data?.messages.length ?? 0)) return
    const timer = setTimeout(() => setCount((n) => n + 1), 1200 / speed)
    return () => clearTimeout(timer)
  }, [count, playing, speed, data?.messages.length])
  const profile = (userId: string) =>
    data?.profiles.find((p) => p.userId === userId)
  const name = (userId: string) =>
    data?.encounter.participants.find((p) => p.userId === userId)?.name ??
    'Representative'
  return (
    <div className="mx-auto max-w-4xl">
      <Button variant="ghost" onClick={back}>
        <ArrowLeft size={16} />
        My profile & encounters
      </Button>
      <div className="my-7 text-center">
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">
          The first date
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">
          Let’s see how they click.
        </h1>
        <p className="mt-3 text-muted-foreground">
          Plan a first Saturday afternoon date: activity, social setting, and
          advance planning.
        </p>
      </div>
      <ErrorNotice error={error} />
      {data && (
        <>
          <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
              <div className="flex items-center gap-3">
                {data.encounter.participants.map((p) => (
                  <span
                    key={p.userId}
                    className="flex items-center gap-2 text-sm font-semibold"
                  >
                    <Avatar seed={profile(p.userId)?.avatarSeed ?? p.name} />
                    {p.name}
                  </span>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">
                {data.encounter.status.replace('_', ' ')} ·{' '}
                {data.messages.length}/6 saved
              </span>
            </div>
            <div
              aria-live="polite"
              className="min-h-[390px] space-y-5 bg-gradient-to-b from-muted/35 to-background p-5 sm:p-8"
            >
              {data.messages.slice(0, count).map((m) => {
                const first =
                  m.speaker === data.encounter.participants[0].userId
                return (
                  <div
                    key={m._id}
                    className={`chat-appear flex items-end gap-2 ${first ? '' : 'flex-row-reverse'}`}
                  >
                    <Avatar
                      seed={profile(m.speaker)?.avatarSeed ?? m.speaker}
                    />
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${first ? 'rounded-bl-md bg-primary/10' : 'rounded-br-md bg-accent'}`}
                    >
                      <span className="mb-1 block text-xs font-semibold">
                        {name(m.speaker)}
                      </span>
                      {m.text}
                    </div>
                  </div>
                )
              })}
              {data.messages.length === 0 && (
                <p className="pt-24 text-center text-sm text-muted-foreground">
                  Your representatives are getting ready…
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-5">
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setPlaying((p) => !p)}
                >
                  {playing ? <Pause size={15} /> : <Play size={15} />}
                  {playing ? 'Pause' : 'Play'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setSpeed((n) => (n === 1 ? 2 : 1))}
                >
                  {speed}×
                </Button>
              </div>
              <span className="text-xs text-muted-foreground">
                Playback controls only
              </span>
            </div>
          </div>
          {data.encounter.status === 'failed' && (
            <Card className="mt-5">
              <p className="mb-4 text-sm">{data.encounter.error}</p>
              <Button
                onClick={async () => {
                  try {
                    await api(`/api/encounters/${id}`, 'POST')
                    setRetry((n) => n + 1)
                  } catch (e) {
                    setError(errorMessage(e))
                  }
                }}
              >
                Retry from saved turns
              </Button>
            </Card>
          )}
          {data.result && (
            <>
              <Results data={data} me={me} />
              <Feedback
                encounterId={id}
                refresh={refresh}
                preferences={me.preferences}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}
function Results({ data, me }: { data: EncounterResponse; me: MeResponse }) {
  const result = data.result!
  const own = result.directions[me.user._id]
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const timer = setInterval(
      () => setShown((n) => Math.min(own.score ?? 0, n + 2)),
      25,
    )
    return () => clearInterval(timer)
  }, [own.score])
  return (
    <Card className="mt-7">
      <div className="grid items-center gap-6 sm:grid-cols-[180px_1fr]">
        <div className="relative mx-auto size-40">
          <svg
            viewBox="0 0 160 160"
            className="size-40 -rotate-90"
            aria-hidden="true"
          >
            <circle
              cx="80"
              cy="80"
              r="68"
              fill="none"
              stroke="currentColor"
              strokeWidth="11"
              className="text-muted"
            />
            <circle
              cx="80"
              cy="80"
              r="68"
              fill="none"
              stroke="currentColor"
              strokeWidth="11"
              strokeLinecap="round"
              strokeDasharray="427.26"
              strokeDashoffset={427.26 * (1 - shown / 100)}
              className="text-primary transition-all"
            />
          </svg>
          <span className="absolute inset-0 grid place-content-center text-center text-4xl font-semibold">
            {own.score === null ? '—' : shown}
            <span className="text-xs font-normal text-muted-foreground">
              your estimate
            </span>
          </span>
        </div>
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">
            Your personalized compatibility estimate
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            How their approved features fit your preferences. This is not a
            probability of relationship success.
          </p>
          <p className="mt-3 text-sm">
            Coverage: {Math.round(own.coverage * 100)}% of eligible weight ·{' '}
            {own.knownDimensions}/{own.eligibleDimensions} known dimensions
          </p>
          {data.encounter.participants
            .filter((p) => p.userId !== me.user._id)
            .map((p) => (
              <p key={p.userId} className="mt-2 text-sm text-muted-foreground">
                {p.name} → you:{' '}
                {result.directions[p.userId].score ?? 'insufficient data'} ·
                coverage{' '}
                {Math.round(result.directions[p.userId].coverage * 100)}%
              </p>
            ))}
        </div>
      </div>
      <div className="mt-8 space-y-4">
        {own.breakdown.map((d) => (
          <div key={d.dimension}>
            <div className="mb-2 flex justify-between text-sm">
              <b>{DIMENSION_LABELS[d.dimension].label}</b>
              <span>
                {Math.round(d.fit * 100)}% fit · weight {d.importance}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/70"
                style={{ width: `${d.fit * 100}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Your desired value {d.desired} · their approved value {d.actual}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-7 grid gap-5 sm:grid-cols-2">
        <div>
          <h3 className="font-semibold">Potential strengths</h3>
          {result.explanations.strengths.map((s) => (
            <p
              key={s}
              className="mt-2 text-sm leading-relaxed text-muted-foreground"
            >
              {s}
            </p>
          ))}
        </div>
        <div>
          <h3 className="font-semibold">Possible friction</h3>
          {result.explanations.friction.map((s) => (
            <p
              key={s}
              className="mt-2 text-sm leading-relaxed text-muted-foreground"
            >
              {s}
            </p>
          ))}
        </div>
      </div>
      {data.comparison && (
        <div className="mt-7 rounded-2xl bg-accent p-5">
          <h3 className="font-semibold">Same person, updated preferences</h3>
          <p className="mt-2 text-sm">
            Preference version {data.comparison.previousVersion}:{' '}
            {data.comparison.previous.score ?? '—'} → version{' '}
            {data.comparison.currentVersion}:{' '}
            {data.comparison.current.score ?? '—'}.
          </p>
          <p className="mt-2 text-sm">
            Both estimates use this encounter’s same frozen partner profile.
            Only your preference version changes. Earlier encounter results
            remain unchanged.
          </p>
          {data.comparison.current.breakdown
            .filter(
              (d) =>
                d.importance >
                (data.comparison!.previous.breakdown.find(
                  (p) => p.dimension === d.dimension,
                )?.importance ?? d.importance),
            )
            .map((d) => (
              <p key={d.dimension} className="mt-2 text-sm font-semibold">
                {DIMENSION_LABELS[d.dimension].label} now matters more to you.
              </p>
            ))}
        </div>
      )}
      <details className="mt-5 text-xs text-muted-foreground">
        <summary>How this was calculated</summary>
        <p className="mt-2">
          100 × weighted mean of (1 − |desired − actual|), using known
          dimensions with positive weights. Algorithm: {result.algorithmVersion}
          .
        </p>
        {result.inputVersions.map((p) => (
          <p className="mt-2 break-all" key={p.userId}>
            {p.name}: profile {p.profileVersionId}, preferences{' '}
            {p.preferenceVersionId}
          </p>
        ))}
      </details>
    </Card>
  )
}
function Feedback({
  encounterId,
  refresh,
  preferences,
}: {
  encounterId: string
  refresh: () => Promise<void>
  preferences: MeResponse['preferences']
}) {
  const [feedback, setFeedback] = useState<DateFeedback | null>(null)
  const [update, setUpdate] = useState<PreferenceUpdate | null>(null)
  const [text, setText] = useState('')
  const [outcome, setOutcome] = useState<'positive' | 'mixed' | 'negative'>(
    'mixed',
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    api<{ feedback: DateFeedback | null; update: PreferenceUpdate | null }>(
      `/api/feedback?encounterId=${encounterId}`,
    )
      .then((data) => {
        if (active) {
          setFeedback(data.feedback)
          setUpdate(data.update)
          setText(data.feedback?.explanation ?? '')
          setOutcome(data.feedback?.outcome ?? 'mixed')
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e))
      })
    return () => {
      active = false
    }
  }, [encounterId])
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="mt-6">
      <h2 className="text-2xl font-semibold">What did you learn?</h2>
      <p className="my-3 text-sm text-muted-foreground">
        After your real date, tell us what worked or what you would want
        differently. A negative date alone does not change your preferences.
      </p>
      <label className="text-sm">
        How did it go?
        <select
          className={`${inputClass} my-2`}
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as typeof outcome)}
        >
          <option value="positive">Positive</option>
          <option value="mixed">Mixed</option>
          <option value="negative">Negative</option>
        </select>
      </label>
      <label className="text-sm">
        Your experience
        <textarea
          className={`${inputClass} my-3 min-h-28`}
          maxLength={3000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What specifically mattered to you?"
        />
      </label>
      <ErrorNotice error={error} />
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={busy || !text.trim()}
          onClick={() =>
            run(async () => {
              const saved = await api<DateFeedback>('/api/feedback', 'POST', {
                encounterId,
                revision: feedback?.revision ?? 0,
                outcome,
                explanation: text,
              })
              setFeedback(saved)
              setUpdate(null)
              setUpdate(
                await api('/api/feedback', 'PATCH', { feedbackId: saved._id }),
              )
            })
          }
        >
          {busy ? 'Saving & reflecting…' : 'Save feedback & find a lesson'}
        </Button>
        {feedback && !update && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                setUpdate(
                  await api('/api/feedback', 'PATCH', {
                    feedbackId: feedback._id,
                  }),
                )
              })
            }
          >
            Retry saved feedback analysis
          </Button>
        )}
      </div>
      {update && (
        <div className="mt-6 rounded-2xl bg-muted p-5">
          <p className="font-semibold">
            {update.status === 'applied'
              ? 'Preference update confirmed'
              : update.status === 'clarify'
                ? 'One more detail would help'
                : update.status === 'no_change'
                  ? 'No preference change proposed'
                  : 'A lesson for next time'}
          </p>
          <p className="mt-2 text-sm">{update.lesson.explanation}</p>
          {update.lesson.clarification && (
            <p className="mt-3 text-sm font-medium">
              {update.lesson.clarification}
            </p>
          )}
          {update.lesson.supportingQuote && (
            <blockquote className="my-3 border-l-2 border-primary pl-3 text-sm">
              “{update.lesson.supportingQuote}”
            </blockquote>
          )}
          {update.lesson.dimension && update.status === 'proposed' && (
            <>
              <p className="my-3 text-sm">
                {DIMENSION_LABELS[update.lesson.dimension].label}: importance{' '}
                {preferences?.dimensions[update.lesson.dimension].importance ??
                  '?'}{' '}
                → {update.lesson.importance ?? 'unchanged'}; desired value{' '}
                {preferences?.dimensions[update.lesson.dimension].desired ??
                  'unknown'}{' '}
                → {update.lesson.desired ?? 'unchanged'}.
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api('/api/preferences', 'POST', {
                      updateId: update._id,
                      confirmed: true,
                    })
                    setUpdate({ ...update, status: 'applied' })
                    await refresh()
                  })
                }
              >
                Confirm preference change
              </Button>
            </>
          )}
          {update.status === 'applied' && (
            <p className="mt-3 text-sm">
              Future encounters use the new version. Your personality and
              historical results are unchanged.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
