'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, RotateCcw } from 'lucide-react'
import {
  DIMENSIONS,
  DIMENSION_LABELS,
  type Features,
  type Interview,
  type MeResponse,
  type Preferences,
  type ProfileDraft,
} from '@/lib/domain'
import { TIPI_INSTRUCTIONS, TIPI_ITEMS, TIPI_OPTIONS } from '@/lib/tipi'
import {
  api,
  Avatar,
  Button,
  Card,
  ErrorNotice,
  errorMessage,
  inputClass,
  Stage,
} from './ui'
import { Imports, PersonaPreview, StyleFields } from './imports'
import { DEFAULT_STYLE, type CommunicationStyle } from '@/lib/import-domain'

export function PreferenceFields({
  value,
  onChange,
}: {
  value: Preferences
  onChange: (value: Preferences) => void
}) {
  return (
    <div className="space-y-5">
      {DIMENSIONS.map((d) => (
        <fieldset key={d}>
          <legend className="mb-2 text-sm font-semibold">
            {DIMENSION_LABELS[d].label}
          </legend>
          <div className="grid gap-2 sm:grid-cols-[1fr_160px]">
            <label className="text-xs text-muted-foreground">
              Desired partner style
              <select
                className={`${inputClass} mt-1`}
                value={value[d].desired ?? ''}
                onChange={(e) =>
                  onChange({
                    ...value,
                    [d]: {
                      ...value[d],
                      desired:
                        e.target.value === '' ? null : Number(e.target.value),
                    },
                  })
                }
              >
                <option value="">Not sure / no preference</option>
                {Array.from({ length: 11 }, (_, i) => (
                  <option key={i} value={i / 10}>
                    {i * 10}%
                    {i === 0
                      ? ` — ${DIMENSION_LABELS[d].low}`
                      : i === 10
                        ? ` — ${DIMENSION_LABELS[d].high}`
                        : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Importance
              <select
                className={`${inputClass} mt-1`}
                value={value[d].importance}
                onChange={(e) =>
                  onChange({
                    ...value,
                    [d]: { ...value[d], importance: Number(e.target.value) },
                  })
                }
              >
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                    {n === 0
                      ? ' — ignore'
                      : n === 1
                        ? ' — normal'
                        : n === 5
                          ? ' — very important'
                          : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            0%: {DIMENSION_LABELS[d].low} · 100%: {DIMENSION_LABELS[d].high}
          </p>
        </fieldset>
      ))}
    </div>
  )
}
function OwnFeatures({
  value,
  onChange,
}: {
  value: Features
  onChange: (value: Features) => void
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {DIMENSIONS.map((d) => (
        <label key={d} className="text-sm font-semibold">
          {DIMENSION_LABELS[d].label}
          <select
            className={`${inputClass} mt-2`}
            value={value[d] ?? ''}
            onChange={(e) =>
              onChange({
                ...value,
                [d]: e.target.value === '' ? null : Number(e.target.value),
              })
            }
          >
            <option value="">Unknown</option>
            {Array.from({ length: 11 }, (_, i) => (
              <option key={i} value={i / 10}>
                {i * 10}%
                {i === 0
                  ? ` — ${DIMENSION_LABELS[d].low}`
                  : i === 10
                    ? ` — ${DIMENSION_LABELS[d].high}`
                    : ''}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            {DIMENSION_LABELS[d].low} → {DIMENSION_LABELS[d].high}
          </span>
        </label>
      ))}
    </div>
  )
}

export function Onboarding({
  me,
  refresh,
}: {
  me: MeResponse
  refresh: () => Promise<void>
}) {
  const interview = me.interview
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!interview) return <p>Loading your interview…</p>
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
    <div className="mx-auto max-w-3xl">
      <Stage
        current={
          interview.stage === 'survey'
            ? 0
            : ['review', 'approved'].includes(interview.stage)
              ? 2
              : 1
        }
      />
      <ErrorNotice error={error} />
      {interview.stage !== 'survey' && (
        <>
          {interview.answers.length === 0 && (
            <p className="my-4 text-sm text-muted-foreground">
              Before your five questions: optionally review imports below, or
              skip them and generate your first question. Imports never replace
              your survey answers.
            </p>
          )}
          <Imports refresh={refresh} />
        </>
      )}
      {interview.stage === 'survey' ? (
        <Survey
          key={interview._id}
          me={me}
          interview={interview}
          busy={busy}
          save={(work) => run(work)}
          refresh={refresh}
        />
      ) : interview.stage === 'review' ? (
        <Review
          interview={interview}
          initialStyle={me.style?.settings ?? DEFAULT_STYLE}
          name={me.user.displayName}
          busy={busy}
          approve={(work) => run(work)}
          refresh={refresh}
        />
      ) : (
        <InterviewQuestions
          interview={interview}
          busy={busy}
          run={run}
          refresh={refresh}
        />
      )}
    </div>
  )
}
function Survey({
  me,
  interview,
  busy,
  save,
  refresh,
}: {
  me: MeResponse
  interview: Interview
  busy: boolean
  save: (work: () => Promise<void>) => Promise<void>
  refresh: () => Promise<void>
}) {
  const [survey, setSurvey] = useState(interview.survey)
  const [preferences, setPreferences] = useState(interview.preferences)
  const [consent, setConsent] = useState(false)
  const [imports, setImports] = useState(false)
  const [saved, setSaved] = useState(false)
  const persist = (submit: boolean) =>
    save(async () => {
      await api('/api/interview', 'PUT', {
        revision: interview.revision,
        survey,
        preferences,
        consent: {
          adult: true,
          survey: true,
          aiProcessing: true,
          sharedProfile: true,
          importedInformation: imports,
        },
        submit,
      })
      await refresh()
      setSaved(true)
    })
  return (
    <>
      <h1 className="text-4xl font-semibold tracking-tight">
        A little more you.
      </h1>
      <p className="mb-7 mt-3 text-muted-foreground">
        Your own style and what you want in a partner are different. We ask
        about both.
      </p>
      <div className="space-y-6">
        <Card>
          <h2 className="mb-4 text-xl font-semibold">
            Your choices, your profile
          </h2>
          <label className="flex items-start gap-3 text-sm leading-relaxed">
            <input
              className="mt-1"
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I am 18 or older. I agree to save my survey and answers and send
            them to OpenAI to create my draft. Only the profile I review and
            approve will represent me in shared AI conversations and
            compatibility estimates.
          </label>
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={imports}
              onChange={(e) => setImports(e.target.checked)}
            />
            Also allow optional imports after this survey to inform my interview
            and profile draft.
          </label>
        </Card>
        <Card>
          <h2 className="mb-2 text-xl font-semibold">
            What would you like in a partner?
          </h2>
          <p className="mb-6 text-sm text-muted-foreground">
            These are reviewed app features, not psychological measurements.
            Leave anything unknown blank.
          </p>
          <PreferenceFields
            value={preferences}
            onChange={(v) => {
              setPreferences(v)
              setSaved(false)
            }}
          />
        </Card>
        <Card>
          <h2 className="mb-3 text-xl font-semibold">
            Ten-Item Personality Inventory
          </h2>
          <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
            {TIPI_INSTRUCTIONS}
          </p>
          <p className="mb-5 font-semibold">I see myself as:</p>
          <div className="space-y-5">
            {TIPI_ITEMS.map((item, i) => (
              <label key={item} className="block text-sm font-medium">
                {i + 1}. {item}
                <select
                  className={`${inputClass} mt-2`}
                  value={survey[i] || ''}
                  onChange={(e) => {
                    setSurvey(
                      survey.map((v, j) =>
                        j === i ? Number(e.target.value) : v,
                      ),
                    )
                    setSaved(false)
                  }}
                >
                  <option value="">Choose a response</option>
                  {TIPI_OPTIONS.map((option, j) => (
                    <option key={option} value={j + 1}>
                      {j + 1} — {option}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className="mt-5 text-xs text-muted-foreground">
            Gosling, Rentfrow & Swann (2003).{' '}
            <a
              className="underline"
              href="https://gosling.psy.utexas.edu/scales-weve-developed/ten-item-personality-measure-tipi/"
              target="_blank"
              rel="noreferrer"
            >
              About TIPI
            </a>
            . The five follow-up questions add context; they are not a validated
            adaptive test.
          </p>
        </Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="secondary"
            disabled={busy || !consent}
            onClick={() => persist(false)}
          >
            {saved ? 'Progress saved' : 'Save progress'}
          </Button>
          <Button
            disabled={busy || !consent || survey.some((n) => n < 1)}
            onClick={() => persist(true)}
          >
            {busy ? 'Saving…' : 'Continue to optional imports & questions'}
            <ArrowRight size={16} />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Save progress before leaving. Submitted answers and generated
          questions are restored when you return.
        </p>
      </div>
    </>
  )
}
function InterviewQuestions({
  interview,
  busy,
  run,
  refresh,
}: {
  interview: Interview
  busy: boolean
  run: (work: () => Promise<void>) => Promise<void>
  refresh: () => Promise<void>
}) {
  const [answer, setAnswer] = useState('')
  const pending =
    interview.stage === 'question_pending' ||
    interview.stage === 'draft_pending'
  return (
    <>
      <h1 className="text-4xl font-semibold tracking-tight">
        Let’s fill in the details.
      </h1>
      <p className="my-4 text-muted-foreground">
        {interview.answers.length} of 5 answers saved. Your own behavior does
        not automatically tell us what you want in a partner.
      </p>
      {interview.answers.map((a) => (
        <details key={a.id} className="mb-3 rounded-xl bg-muted p-4 text-sm">
          <summary>{a.question.question}</summary>
          <p className="mt-3">{a.text}</p>
        </details>
      ))}
      <Card className="mt-6">
        {pending ? (
          <>
            <h2 className="text-xl font-semibold">
              {interview.stage === 'draft_pending'
                ? 'Your profile is ready to draft'
                : 'Ready for the next question'}
            </h2>
            <p className="my-4 text-sm text-muted-foreground">
              Your progress is saved. If generation is interrupted, you can
              retry here.
            </p>
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api('/api/interview', 'POST')
                  await refresh()
                })
              }
            >
              {busy
                ? 'Thinking…'
                : interview.stage === 'draft_pending'
                  ? 'Generate profile draft'
                  : 'Ask my next question'}
            </Button>
          </>
        ) : (
          <>
            <span className="text-xs font-semibold uppercase tracking-widest text-primary">
              Question {interview.answers.length + 1} of 5
            </span>
            <h2 className="my-4 text-xl font-semibold">
              {interview.currentQuestion?.question}
            </h2>
            <label className="text-sm">
              Your answer
              <textarea
                className={`${inputClass} my-3 min-h-32`}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                maxLength={2000}
              />
            </label>
            <Button
              disabled={busy || !answer.trim()}
              onClick={() =>
                run(async () => {
                  await api('/api/interview', 'PATCH', {
                    revision: interview.revision,
                    answer,
                  })
                  setAnswer('')
                  await refresh()
                  await api('/api/interview', 'POST')
                  await refresh()
                })
              }
            >
              {busy ? 'Saving & thinking…' : 'Save answer & continue'}
              <ArrowRight size={16} />
            </Button>
          </>
        )}
      </Card>
    </>
  )
}
function Review({
  interview,
  initialStyle,
  name,
  busy,
  approve,
  refresh,
}: {
  interview: Interview
  initialStyle: CommunicationStyle
  name: string
  busy: boolean
  approve: (work: () => Promise<void>) => Promise<void>
  refresh: () => Promise<void>
}) {
  const [communicationStyle, setCommunicationStyle] = useState(initialStyle)
  const [draft, setDraft] = useState<ProfileDraft>(interview.draft!)
  const [preferences, setPreferences] = useState(interview.preferences)
  const [seed, setSeed] = useState(name)
  const [confirmed, setConfirmed] = useState(false)
  return (
    <>
      <h1 className="text-4xl font-semibold tracking-tight">
        Meet your AI self, {name}.
      </h1>
      <p className="my-4 text-muted-foreground">
        Edit anything that does not sound like you. Only the approved fields
        below will be shared.
      </p>
      <PersonaPreview refresh={refresh} />
      <Card>
        <div className="mb-6 flex items-center gap-5">
          <Avatar seed={seed} large />
          <Button
            variant="secondary"
            onClick={() => setSeed(crypto.randomUUID())}
          >
            <RotateCcw size={16} />
            Change look
          </Button>
        </div>
        <label className="text-sm font-semibold">
          Summary
          <textarea
            className={`${inputClass} mb-5 mt-2 min-h-32`}
            value={draft.summary}
            maxLength={1800}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
          />
        </label>
        <label className="text-sm font-semibold">
          Traits (comma separated)
          <input
            className={`${inputClass} mb-5 mt-2`}
            value={draft.traits.join(', ')}
            onChange={(e) =>
              setDraft({
                ...draft,
                traits: e.target.value.split(',').map((v) => v.trim()),
              })
            }
          />
        </label>
        <label className="text-sm font-semibold">
          Interests (comma separated)
          <input
            className={`${inputClass} mb-5 mt-2`}
            value={draft.interests.join(', ')}
            onChange={(e) =>
              setDraft({
                ...draft,
                interests: e.target.value.split(',').map((v) => v.trim()),
              })
            }
          />
        </label>
        <label className="text-sm font-semibold">
          Conversation style
          <textarea
            className={`${inputClass} mb-5 mt-2`}
            value={draft.style}
            maxLength={400}
            onChange={(e) => setDraft({ ...draft, style: e.target.value })}
          />
        </label>
        <h2 className="mb-4 text-xl font-semibold">Communication style</h2>
        <StyleFields
          value={communicationStyle}
          onChange={setCommunicationStyle}
        />
        <h2 className="mb-4 mt-6 text-xl font-semibold">My own features</h2>
        <OwnFeatures
          value={draft.features}
          onChange={(features) => setDraft({ ...draft, features })}
        />
        {draft.unresolved.length > 0 && (
          <div className="mt-6 rounded-xl bg-muted p-4 text-sm">
            <b>Still uncertain</b>
            {draft.unresolved.map((s) => (
              <p key={s} className="mt-2">
                {s}
              </p>
            ))}
          </div>
        )}
        <details className="mt-6">
          <summary className="cursor-pointer font-semibold">
            Review my partner preferences
          </summary>
          <div className="mt-5">
            <PreferenceFields value={preferences} onChange={setPreferences} />
          </div>
        </details>
        <label className="my-6 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I reviewed my shareable profile, own features and partner preferences,
          and approve using them for encounters.
        </label>
        <Button
          disabled={busy || !confirmed}
          onClick={() =>
            approve(async () => {
              await api('/api/profile', 'POST', {
                revision: interview.revision,
                profile: {
                  summary: draft.summary,
                  traits: draft.traits.filter(Boolean),
                  interests: draft.interests.filter(Boolean),
                  style: draft.style,
                  features: draft.features,
                },
                preferences,
                communicationStyle,
                avatarSeed: seed,
                confirmed: true,
              })
              await refresh()
            })
          }
        >
          {busy ? 'Approving…' : 'Approve my profile'}
          <ArrowRight size={16} />
        </Button>
      </Card>
    </>
  )
}
