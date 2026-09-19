'use client'
import { useState } from 'react'
import { api, Button, ErrorNotice, errorMessage, inputClass } from './ui'

export function EmailSignIn({
  onSignedIn,
}: {
  onSignedIn: () => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [adult, setAdult] = useState(false)
  const [sent, setSent] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setError('')
        try {
          if (sent) {
            await api('/api/auth/email', 'PATCH', { token: token.trim() })
            await onSignedIn()
          } else {
            await api('/api/auth/email', 'POST', {
              email: email.trim(),
              displayName: name,
              adult,
            })
            setSent(true)
          }
        } catch (e) {
          setError(errorMessage(e))
        } finally {
          setBusy(false)
        }
      }}
    >
      <h2 className="mb-4 text-2xl font-semibold">Your account, your email.</h2>
      <p className="mb-5 text-sm text-muted-foreground">
        Sign in, create an account, or recover access using the same verified
        email. We never access your mailbox.
      </p>
      {sent ? (
        <label className="block text-sm">
          Paste the single-use code from your email (expires in 15 minutes)
          <input
            className={`${inputClass} my-3`}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            maxLength={64}
            autoComplete="one-time-code"
            required
          />
        </label>
      ) : (
        <>
          <label className="block text-sm">
            Email
            <input
              className={`${inputClass} my-3`}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
              required
            />
          </label>
          <label className="block text-sm">
            Display name (used for a new account)
            <input
              className={`${inputClass} my-3`}
              autoComplete="given-name"
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
      )}
      <ErrorNotice error={error} />
      <Button type="submit" disabled={busy}>
        {busy
          ? 'Connecting…'
          : sent
            ? 'Verify & continue'
            : 'Email me a sign-in code'}
      </Button>
      {sent && (
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setSent(false)
            setToken('')
          }}
        >
          Use another email / resend
        </Button>
      )}
    </form>
  )
}
