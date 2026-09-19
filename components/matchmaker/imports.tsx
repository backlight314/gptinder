'use client'

import { useEffect, useState } from 'react'
import {
  parseWhatsApp,
  redactParticipants,
  type ParsedMessage,
  type DateOrder,
} from '@/lib/whatsapp'
import {
  DEFAULT_STYLE,
  PREVIEW_SCENARIOS,
  type CommunicationStyle,
  type ImportSource,
  type PreviewRecord,
  type WritingSample,
} from '@/lib/import-domain'
import { api, Button, Card, ErrorNotice, errorMessage, inputClass } from './ui'

export function StyleFields({
  value,
  onChange,
}: {
  value: CommunicationStyle
  onChange: (value: CommunicationStyle) => void
}) {
  const fields = {
    tone: ['warm', 'playful', 'matter-of-fact', 'reflective'],
    length: ['short', 'medium', 'long'],
    emoji: ['none', 'occasional', 'frequent'],
    directness: ['gentle', 'balanced', 'direct'],
  } as const
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        {(Object.keys(fields) as (keyof typeof fields)[]).map((field) => (
          <label key={field} className="text-sm capitalize">
            {field}
            <select
              className={`${inputClass} mt-1`}
              value={value[field]}
              onChange={(e) => onChange({ ...value, [field]: e.target.value })}
            >
              {fields[field].map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <label className="mt-4 block text-sm">
        Style notes (no private names or events)
        <textarea
          className={`${inputClass} mt-1`}
          value={value.notes}
          maxLength={400}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
        />
      </label>
    </div>
  )
}

export function Imports({
  refresh,
  allowCreate = true,
}: {
  refresh: () => Promise<void>
  allowCreate?: boolean
}) {
  const [sources, setSources] = useState<ImportSource[]>([])
  const [selectedSource, setSelectedSource] = useState<ImportSource | null>(
    null,
  )
  const [messages, setMessages] = useState<ParsedMessage[]>([])
  const [author, setAuthor] = useState('')
  const [samples, setSamples] = useState<WritingSample[]>([])
  const [label, setLabel] = useState('Selected writing examples')
  const [reviewed, setReviewed] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [sourceType, setSourceType] = useState<
    'whatsapp' | 'writing' | 'professional'
  >('whatsapp')
  const [dateOrder, setDateOrder] = useState<DateOrder>('auto')
  const [pasted, setPasted] = useState('')
  const load = async () => setSources(await api('/api/imports'))
  useEffect(() => {
    void load().catch((e) => setError(errorMessage(e)))
  }, [])
  useEffect(() => {
    if (
      !selectedSource ||
      !['pending_start', 'extracting'].includes(selectedSource.status)
    )
      return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    let lastRetry = 0
    const poll = async () => {
      try {
        const data = await api<ImportSource>(
          `/api/imports/${selectedSource._id}`,
        )
        if (!active) return
        setSelectedSource(data)
        if (['pending_start', 'extracting'].includes(data.status)) {
          if (Date.now() - lastRetry > 65000) {
            lastRetry = Date.now()
            await api(`/api/imports/${data._id}`, 'POST')
          }
          timer = setTimeout(poll, document.hidden ? 5000 : 1500)
        } else await load()
      } catch (e) {
        if (active) setError(errorMessage(e))
      }
    }
    void poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [selectedSource?._id, selectedSource?.status])
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
  const authors = [...new Set(messages.map((m) => m.author))]
  const candidates = messages.filter(
    (m) =>
      m.author === author &&
      m.text.toLowerCase().includes(search.toLowerCase()),
  )
  return (
    <Card className="my-6">
      <details open>
        <summary className="cursor-pointer text-xl font-semibold">
          Help your AI sound like you — optional
        </summary>
        <p className="my-4 text-sm leading-relaxed text-muted-foreground">
          Your WhatsApp text file stays in this browser. Choose your own
          messages, redact private details, and review every selected excerpt.
          Only those excerpts are uploaded. Save survey consent with imports
          enabled before uploading. No WhatsApp account access is needed.
        </p>
        <ErrorNotice error={error} />
        {sources.map((source) => (
          <div
            key={source._id}
            className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted p-3 text-sm"
          >
            <button
              className="text-left underline"
              onClick={() =>
                run(async () =>
                  setSelectedSource(await api(`/api/imports/${source._id}`)),
                )
              }
            >
              {source.label} · {source.status.replace('_', ' ')}
            </button>
            <Button variant="ghost" onClick={() => setDeleting(source._id)}>
              Delete source
            </Button>
          </div>
        ))}
        {deleting && (
          <div className="my-4 rounded-xl border border-destructive/30 p-4 text-sm">
            <p>
              Delete these excerpts and derived claims? Dependent styles,
              previews and profiles will be invalidated, and affected
              conversations removed. You will need to review your profile again.
            </p>
            <div className="mt-3 flex gap-3">
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api(`/api/imports/${deleting}`, 'DELETE')
                    setDeleting(null)
                    setSelectedSource(null)
                    await load()
                    await refresh()
                  })
                }
              >
                Confirm source deletion
              </Button>
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {selectedSource?.status === 'review' && (
          <ImportReview
            key={selectedSource._id}
            source={selectedSource}
            busy={busy}
            save={(work) => run(work)}
            done={async () => {
              setSelectedSource(null)
              await load()
              await refresh()
            }}
          />
        )}
        {selectedSource &&
          ['pending_start', 'extracting', 'failed'].includes(
            selectedSource.status,
          ) && (
            <div className="my-4 rounded-xl bg-muted p-4">
              <p className="text-sm">
                {selectedSource.error ??
                  'Extracting a review draft. Reserved samples are withheld.'}
              </p>
              <Button
                className="mt-3"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api(`/api/imports/${selectedSource._id}`, 'POST')
                    setSelectedSource(
                      await api(`/api/imports/${selectedSource._id}`),
                    )
                  })
                }
              >
                Retry / check saved import
              </Button>
            </div>
          )}
        {allowCreate && (
          <>
            <label className="my-4 block text-sm">
              Source type
              <select
                className={`${inputClass} mt-2`}
                value={sourceType}
                onChange={(e) => {
                  setSourceType(e.target.value as typeof sourceType)
                  setSamples([])
                  setMessages([])
                  setReviewed(false)
                  setPasted('')
                }}
              >
                <option value="whatsapp">Selected WhatsApp messages</option>
                <option value="writing">Paste my own writing samples</option>
                <option value="professional">
                  Professional background / résumé text
                </option>
              </select>
            </label>
            {sourceType !== 'whatsapp' && (
              <>
                <p className="my-3 text-sm text-muted-foreground">
                  {sourceType === 'professional'
                    ? 'Supply your own profile export or résumé as plain text. This supports approved facts and interests, not personality or communication-style inference. No LinkedIn scraping or sign-in is required.'
                    : 'Paste only your own writing, separating samples with a blank line. Reserve at least one distinct example for evaluation.'}
                </p>
                <label className="block text-sm">
                  Open my own .txt file
                  <input
                    className={`${inputClass} my-2`}
                    type="file"
                    accept=".txt,text/plain"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file)
                        void run(async () => {
                          if (file.size > 80000)
                            throw new Error(
                              'Select up to 80,000 bytes of text.',
                            )
                          setPasted(await file.text())
                        })
                    }}
                  />
                </label>
                <label className="block text-sm">
                  Or paste reviewed text
                  <textarea
                    className={`${inputClass} my-2`}
                    maxLength={80000}
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                  />
                </label>
                <Button
                  variant="secondary"
                  disabled={!pasted.trim()}
                  onClick={() =>
                    run(async () => {
                      const chunks = pasted
                        .split(/\n\s*\n/)
                        .flatMap(
                          (paragraph) =>
                            paragraph.match(/[\s\S]{1,600}/g) ?? [],
                        )
                      const texts = [
                        ...new Set(
                          chunks
                            .map((text) => redactParticipants(text.trim(), []))
                            .filter((text) => text.length >= 5),
                        ),
                      ]
                      if (texts.length > 200)
                        throw new Error('Select at most 200 excerpts.')
                      setSamples(
                        texts.map((text, index) => ({
                          id: crypto.randomUUID(),
                          text,
                          author: 'self',
                          role:
                            sourceType !== 'professional' &&
                            index === texts.length - 1
                              ? 'holdout'
                              : 'training',
                        })),
                      )
                      setReviewed(false)
                    })
                  }
                >
                  Preview selected excerpts locally
                </Button>
              </>
            )}
            {sourceType === 'whatsapp' && (
              <>
                <label className="block text-sm">
                  Export date format
                  <select
                    className={`${inputClass} my-2`}
                    value={dateOrder}
                    onChange={(e) => setDateOrder(e.target.value as DateOrder)}
                  >
                    <option value="auto">Detect only if unambiguous</option>
                    <option value="DMY">Day / month / year</option>
                    <option value="MDY">Month / day / year</option>
                  </select>
                </label>
                <label className="my-4 block text-sm font-semibold">
                  Open a WhatsApp .txt export (up to 2 MB)
                  <input
                    type="file"
                    accept=".txt,text/plain"
                    className={`${inputClass} mt-2`}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      void run(async () => {
                        if (file.size > 2_000_000)
                          throw new Error('Choose a text file under 2 MB.')
                        const parsed = parseWhatsApp(
                          await file.text(),
                          dateOrder,
                        )
                        if (!parsed.length)
                          throw new Error(
                            'No messages recognized. Use a WhatsApp text export without media.',
                          )
                        setMessages(parsed)
                        setAuthor('')
                        setPage(0)
                        setSamples([])
                        setReviewed(false)
                      })
                    }}
                  />
                </label>
                {messages.length > 0 && (
                  <>
                    <label className="block text-sm">
                      Which sender is you?
                      <select
                        className={`${inputClass} my-2`}
                        value={author}
                        onChange={(e) => {
                          setAuthor(e.target.value)
                          setSamples([])
                          setPage(0)
                          setReviewed(false)
                        }}
                      >
                        <option value="">Choose your name</option>
                        {authors.map((name) => (
                          <option key={name}>{name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm">
                      Search your messages
                      <input
                        className={`${inputClass} my-2`}
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value)
                          setPage(0)
                        }}
                      />
                    </label>
                    <div className="max-h-72 space-y-2 overflow-auto">
                      {candidates
                        .slice(page * 20, (page + 1) * 20)
                        .map((message) => (
                          <div
                            key={message.id}
                            className="rounded-xl border border-border p-3"
                          >
                            <p className="whitespace-pre-wrap text-sm">
                              {message.text}
                            </p>
                            <Button
                              className="mt-2"
                              variant="ghost"
                              disabled={
                                samples.length >= 200 ||
                                samples.some(
                                  (sample) =>
                                    sample.text ===
                                    redactParticipants(
                                      message.text,
                                      authors,
                                    ).slice(0, 600),
                                )
                              }
                              onClick={() => {
                                setSamples([
                                  ...samples,
                                  {
                                    id: crypto.randomUUID(),
                                    text: redactParticipants(
                                      message.text,
                                      authors,
                                    ).slice(0, 600),
                                    author: 'self',
                                    timestamp: message.timestamp,
                                    role: 'training',
                                  },
                                ])
                                setReviewed(false)
                              }}
                            >
                              Select & redact
                            </Button>
                          </div>
                        ))}
                    </div>
                    <div className="my-3 flex gap-3">
                      <Button
                        variant="ghost"
                        disabled={page === 0}
                        onClick={() => setPage((n) => n - 1)}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={(page + 1) * 20 >= candidates.length}
                        onClick={() => setPage((n) => n + 1)}
                      >
                        Next
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setMessages([])
                          setAuthor('')
                        }}
                      >
                        Clear raw file from view
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
            {samples.length > 0 && (
              <>
                <h3 className="mt-5 font-semibold">
                  Review exactly what will leave this browser
                </h3>
                <p className="my-2 text-xs text-muted-foreground">
                  Up to 200 excerpts / 80,000 characters. For writing, choose at
                  least two training examples and reserve at least one for
                  evaluation. Remove names, events, identifying details and
                  anything written by another person.
                </p>
                {samples.map((sample) => (
                  <div key={sample.id} className="my-3 rounded-xl bg-muted p-3">
                    <textarea
                      aria-label="Reviewed writing sample"
                      className={inputClass}
                      maxLength={600}
                      value={sample.text}
                      onChange={(e) => {
                        setSamples(
                          samples.map((s) =>
                            s.id === sample.id
                              ? { ...s, text: e.target.value }
                              : s,
                          ),
                        )
                        setReviewed(false)
                      }}
                    />
                    <div className="mt-2 flex items-center gap-3">
                      <label className="text-xs">
                        Use
                        <select
                          disabled={sourceType === 'professional'}
                          className={`${inputClass} mt-1`}
                          value={sample.role}
                          onChange={(e) =>
                            setSamples(
                              samples.map((s) =>
                                s.id === sample.id
                                  ? {
                                      ...s,
                                      role: e.target
                                        .value as WritingSample['role'],
                                    }
                                  : s,
                              ),
                            )
                          }
                        >
                          <option value="training">
                            Extraction & approved style
                          </option>
                          <option value="holdout">
                            Reserved evaluation only
                          </option>
                        </select>
                      </label>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          setSamples(samples.filter((s) => s.id !== sample.id))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
                <label className="block text-sm">
                  Import label
                  <input
                    className={`${inputClass} my-2`}
                    maxLength={100}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </label>
                <label className="my-4 flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  I wrote every selected message, reviewed/redacted each
                  excerpt, and approve sending only these excerpts to OpenAI for
                  extraction and style evaluation.
                </label>
                <Button
                  disabled={
                    busy ||
                    !reviewed ||
                    samples.length < (sourceType === 'professional' ? 1 : 3)
                  }
                  onClick={() =>
                    run(async () => {
                      const result = await api<{ importId: string }>(
                        '/api/imports',
                        'POST',
                        {
                          label,
                          sourceType,
                          samples,
                          reviewed: true,
                          ownMessagesOnly: true,
                        },
                      )
                      setMessages([])
                      setSamples([])
                      setPasted('')
                      setReviewed(false)
                      setSelectedSource(
                        await api(`/api/imports/${result.importId}`),
                      )
                      await load()
                      await refresh()
                    })
                  }
                >
                  {busy ? 'Saving…' : 'Upload reviewed selection'}
                </Button>
              </>
            )}
          </>
        )}
      </details>
    </Card>
  )
}

function ImportReview({
  source,
  busy,
  save,
  done,
}: {
  source: ImportSource
  busy: boolean
  save: (work: () => Promise<void>) => Promise<void>
  done: () => Promise<void>
}) {
  const [claims, setClaims] = useState<number[]>([])
  const [style, setStyle] = useState(source.draft?.style ?? DEFAULT_STYLE)
  const [examples, setExamples] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState(false)
  return (
    <div className="my-5 rounded-2xl border border-primary/30 p-4">
      <h3 className="text-lg font-semibold">
        Approve supported claims and style
      </h3>
      {source.statistics.count > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Observed training text: {source.statistics.count} samples ·{' '}
          {source.statistics.meanWords.toFixed(1)} words/message ·{' '}
          {Math.round(source.statistics.questionRate * 100)}% with questions ·{' '}
          {Math.round(source.statistics.emojiRate * 100)}% with emoji.
          Descriptive only; these do not affect compatibility.
        </p>
      )}
      <p className="my-3 text-sm text-muted-foreground">
        Candidate interpretations are not facts until you approve them.
        Unchecked claims and examples are not used by your representative.
      </p>
      {source.draft?.claims.map((claim, i) => (
        <label key={i} className="my-3 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={claims.includes(i)}
            onChange={(e) =>
              setClaims(
                e.target.checked
                  ? [...claims, i]
                  : claims.filter((n) => n !== i),
              )
            }
          />
          <span>
            {claim.text}
            <span className="block text-xs text-muted-foreground">
              {claim.category.replace('_', ' ')} · {claim.context} ·{' '}
              {claim.allowedUse.replace('_', ' ')}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Supporting excerpts:{' '}
              {claim.sampleIds
                .map((id) => source.samples.find((s) => s.id === id)?.text)
                .join(' / ')}
            </span>
          </span>
        </label>
      ))}
      {source.sourceType !== 'professional' && (
        <StyleFields value={style} onChange={setStyle} />
      )}
      <p className="mb-2 mt-5 text-sm font-semibold">
        Examples allowed for broad style (up to 5)
      </p>
      {source.samples
        .filter(
          (s) => s.role === 'training' && source.sourceType !== 'professional',
        )
        .map((s) => (
          <label key={s.id} className="my-3 flex gap-3 text-sm">
            <input
              type="checkbox"
              checked={examples.includes(s.id)}
              disabled={!examples.includes(s.id) && examples.length >= 5}
              onChange={(e) =>
                setExamples(
                  e.target.checked
                    ? [...examples, s.id]
                    : examples.filter((id) => id !== s.id),
                )
              }
            />
            {s.text}
          </label>
        ))}
      {source.draft?.uncertainty.map((text) => (
        <p key={text} className="my-2 text-xs text-muted-foreground">
          Uncertain: {text}
        </p>
      ))}
      <label className="my-4 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I approve the checked claims, style settings and selected examples.
        Examples remain private and must not be copied into shared messages.
      </label>
      <Button
        disabled={busy || !confirmed}
        onClick={() =>
          save(async () => {
            await api(`/api/imports/${source._id}/approve`, 'POST', {
              revision: source.revision,
              claimIndexes: claims,
              style,
              sampleIds: examples,
              confirmed: true,
            })
            await done()
          })
        }
      >
        Approve selected material
      </Button>
    </div>
  )
}

export function PersonaPreview({ refresh }: { refresh: () => Promise<void> }) {
  const [scenario, setScenario] = useState(0)
  const [preview, setPreview] = useState<PreviewRecord | null>(null)
  const [records, setRecords] = useState<PreviewRecord[]>([])
  const [choice, setChoice] = useState<'baseline' | 'enhanced'>('enhanced')
  const [edited, setEdited] = useState('')
  const [baseRating, setBaseRating] = useState(3)
  const [enhancedRating, setEnhancedRating] = useState(3)
  const [attribution, setAttribution] = useState(false)
  const [unsupported, setUnsupported] = useState(0)
  const [disclosure, setDisclosure] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async () => setRecords(await api('/api/persona-preview'))
  useEffect(() => {
    void load().catch((e) => setError(errorMessage(e)))
  }, [])
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
    <Card className="my-6">
      <h2 className="text-2xl font-semibold">Does this sound like you?</h2>
      <p className="my-3 text-sm text-muted-foreground">
        Compare a survey-only response with a response using your approved
        context and writing style. Reserved examples are used only for
        evaluation. Try several situations before approving your profile.
      </p>
      <label className="text-sm">
        Scenario
        <select
          className={`${inputClass} my-3`}
          value={scenario}
          onChange={(e) => setScenario(Number(e.target.value))}
        >
          {PREVIEW_SCENARIOS.map((s, i) => (
            <option key={s} value={i}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <Button
        disabled={busy}
        onClick={() =>
          run(async () => {
            const result = await api<PreviewRecord>(
              '/api/persona-preview',
              'POST',
              { action: 'generate', scenario },
            )
            setPreview(result)
            setChoice('enhanced')
            setEdited(result.enhanced)
            setAttribution(false)
            await load()
          })
        }
      >
        {busy ? 'Working…' : 'Compare responses'}
      </Button>
      <ErrorNotice error={error} />
      {preview && (
        <>
          <div className="my-5 grid gap-4 sm:grid-cols-2">
            {(['baseline', 'enhanced'] as const).map((side) => (
              <div
                key={side}
                className={`rounded-2xl p-4 ${side === 'baseline' ? 'bg-muted' : 'bg-accent'}`}
              >
                <h3 className="font-semibold">
                  {side === 'baseline'
                    ? 'Survey only'
                    : 'Approved context & imports'}
                </h3>
                <p className="my-3 text-sm leading-relaxed">{preview[side]}</p>
                <label className="text-sm">
                  How much does it sound like you? (1–5)
                  <select
                    className={`${inputClass} my-2`}
                    value={side === 'baseline' ? baseRating : enhancedRating}
                    onChange={(e) =>
                      side === 'baseline'
                        ? setBaseRating(Number(e.target.value))
                        : setEnhancedRating(Number(e.target.value))
                    }
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setChoice(side)
                    setEdited(preview[side])
                  }}
                >
                  {choice === side ? 'Selected' : 'Choose this response'}
                </Button>
              </div>
            ))}
          </div>
          <label className="text-sm font-semibold">
            Edit your preferred response
            <textarea
              className={`${inputClass} my-2 min-h-24`}
              value={edited}
              maxLength={1000}
              onChange={(e) => setEdited(e.target.value)}
            />
          </label>
          <label className="my-3 flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={attribution}
              onChange={(e) => setAttribution(e.target.checked)}
            />
            The selected import messages were correctly attributed to me.
          </label>
          <label className="block text-sm">
            Unsupported personal claims I noticed
            <input
              type="number"
              min={0}
              max={20}
              className={`${inputClass} my-2`}
              value={unsupported}
              onChange={(e) => setUnsupported(Number(e.target.value))}
            />
          </label>
          <label className="my-3 flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={disclosure}
              onChange={(e) => setDisclosure(e.target.checked)}
            />
            I noticed copying or disclosure of private content.
          </label>
          <Button
            disabled={busy || !edited.trim()}
            onClick={() =>
              run(async () => {
                await api('/api/persona-preview', 'POST', {
                  action: 'review',
                  previewId: preview._id,
                  choice,
                  editedText: edited,
                  baselineResemblance: baseRating,
                  enhancedResemblance: enhancedRating,
                  attributionCorrect: attribution,
                  unsupportedClaims: unsupported,
                  disclosureOrCopying: disclosure,
                })
                await load()
                await refresh()
                setPreview(null)
              })
            }
          >
            Save my choice & evaluation
          </Button>
          <details className="mt-4 text-xs text-muted-foreground">
            <summary>Automated checks</summary>
            <p className="mt-2">
              Unsupported claims (survey / enhanced):{' '}
              {preview.metrics.baselineUnsupportedClaims} /{' '}
              {preview.metrics.enhancedUnsupportedClaims}. Possible disclosures:{' '}
              {preview.metrics.baselineDisclosures} /{' '}
              {preview.metrics.enhancedDisclosures}. Copy detected:{' '}
              {String(preview.metrics.baselineCopyDetected)} /{' '}
              {String(preview.metrics.enhancedCopyDetected)}.
            </p>
            <p className="mt-2">
              Reserved examples: {preview.metrics.holdoutCount}. Style distance
              (length, emoji, punctuation; lower is closer):{' '}
              {preview.metrics.holdoutStyleDistance
                ? `${preview.metrics.holdoutStyleDistance.baseline} / ${preview.metrics.holdoutStyleDistance.enhanced}`
                : 'No reserved examples'}
              . These checks can miss errors; your review matters.
            </p>
          </details>
        </>
      )}
      <div className="mt-5 text-sm text-muted-foreground">
        {records.filter((r) => r.review).length} evaluations saved across{' '}
        {new Set(records.filter((r) => r.review).map((r) => r.scenario)).size}{' '}
        scenarios. This measures representation for you, not scientific
        personality accuracy.
      </div>
    </Card>
  )
}
