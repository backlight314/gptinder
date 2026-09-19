'use client'

import NiceAvatar, { genConfig } from 'react-nice-avatar'
import { Sparkles } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export const inputClass =
  'w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary'
export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost'
}) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold transition-all active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-60 ${variant === 'primary' ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:brightness-105' : variant === 'secondary' ? 'border border-border bg-card hover:bg-muted' : 'text-muted-foreground hover:text-foreground'} ${className}`}
    >
      {children}
    </button>
  )
}
export function Logo() {
  return (
    <div className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-8 place-items-center rounded-xl bg-foreground text-background">
        <Sparkles size={16} />
      </span>
      <span>
        AI <span className="text-primary">Matchmaker</span>
      </span>
    </div>
  )
}
export function Avatar({
  seed,
  large = false,
}: {
  seed: string
  large?: boolean
}) {
  return (
    <NiceAvatar
      className={`${large ? 'size-24' : 'size-10'} shrink-0`}
      {...genConfig(seed)}
    />
  )
}
export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-7 ${className}`}
    >
      {children}
    </section>
  )
}
export function ErrorNotice({ error }: { error: string }) {
  return error ? (
    <p
      role="alert"
      className="my-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
    >
      {error}
    </p>
  ) : null
}
export function Stage({ current }: { current: number }) {
  return (
    <ol
      aria-label="Your progress"
      className="mb-8 flex flex-wrap gap-4 text-xs text-muted-foreground"
    >
      {[
        'Preferences & survey',
        'Five questions',
        'Review profile',
        'Meet & learn',
      ].map((label, i) => (
        <li
          key={label}
          aria-current={current === i ? 'step' : undefined}
          className={`flex items-center gap-2 ${current === i ? 'font-semibold text-primary' : ''}`}
        >
          <span
            className={`grid size-6 place-items-center rounded-full border ${current >= i ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}
          >
            {i + 1}
          </span>
          {label}
        </li>
      ))}
    </ol>
  )
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(65000),
  })
  const value = await response.json()
  if (!response.ok)
    throw new ApiError(
      value.error ?? 'Request failed. Please try again.',
      response.status,
    )
  return value as T
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please retry.'
