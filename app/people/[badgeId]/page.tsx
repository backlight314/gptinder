import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import ProfileAnalyzer from '@/components/profile-analyzer'
import { getPublicProfile, listProfileConnections } from '@/lib/airos-directory-store'

export const dynamic = 'force-dynamic'
type Props = { params: Promise<{ badgeId: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await getPublicProfile((await params).badgeId)
  return {
    title: profile ? `${profile.name} — Hack the Heart` : 'Profile not found — Hack the Heart',
    description: profile ? `${profile.name}'s badge-imported Hack the Heart profile.` : 'Hack the Heart profile.',
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noimageindex: true } },
  }
}

function ContactLink({ label, value, href }: { label: string; value: string | null; href?: string }) {
  if (!value) return null
  return <div className="rounded-2xl border bg-card p-4"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>{href ? <a className="mt-1 block break-all font-semibold text-primary hover:underline" href={href} target="_blank" rel="noreferrer">{value}</a> : <p className="mt-1 break-all font-semibold">{value}</p>}</div>
}

export default async function PersonPage({ params }: Props) {
  const { badgeId } = await params
  const profile = await getPublicProfile(badgeId)
  if (!profile) notFound()
  const connections = await listProfileConnections(profile.badgeId)
  return <main className="mx-auto min-h-screen max-w-5xl px-5 py-10 sm:px-8">
    <nav className="mb-12 flex items-center justify-between"><Link href="/" className="text-xl font-black">Hack the Heart</Link><Link href="/import" className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground">Import badge</Link></nav>
    <header className="rounded-[2rem] border bg-card p-7 sm:p-10"><div className="flex flex-wrap items-start justify-between gap-6"><div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">badge imported</span><h1 className="mt-5 text-4xl font-black tracking-tight sm:text-6xl">{profile.name}</h1><p className="mt-3 text-lg text-muted-foreground">{profile.role || 'Hack the North participant'}</p><p className="mt-2 font-mono text-sm text-muted-foreground">{profile.badgeId}</p></div><div className="grid grid-cols-2 gap-3 text-center"><div className="rounded-2xl bg-muted p-4"><p className="text-2xl font-black">{profile.connectionCount}</p><p className="text-xs text-muted-foreground">connections</p></div><div className="rounded-2xl bg-muted p-4"><p className="text-2xl font-black">{profile.observationCount}</p><p className="text-xs text-muted-foreground">observations</p></div></div></div></header>
    <section className="mt-8 grid gap-4 sm:grid-cols-2"><ContactLink label="Email" value={profile.email} href={profile.email ? `mailto:${profile.email}` : undefined} /><ContactLink label="Phone" value={profile.phone} href={profile.phone ? `tel:${profile.phone}` : undefined} /><ContactLink label="LinkedIn" value={profile.linkedin} href={profile.linkedin || undefined} /><ContactLink label="Instagram" value={profile.instagram} href={profile.instagram || undefined} /><ContactLink label="X / Twitter" value={profile.x} href={profile.x || undefined} /><ContactLink label="Discord" value={profile.discord} /></section>
    <section className="mt-8 rounded-3xl border bg-card p-6 sm:p-8"><div className="flex flex-wrap items-start justify-between gap-5"><div><h2 className="text-2xl font-black">AI profile</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">On-demand analysis uses public supported social profiles. Scraped text is treated as untrusted reference material and sensitive traits are not inferred.</p></div><ProfileAnalyzer badgeId={profile.badgeId} /></div>{profile.analysis && <div className="mt-8"><h3 className="text-xl font-bold">{profile.analysis.headline}</h3><p className="mt-3 leading-7 text-muted-foreground">{profile.analysis.summary}</p>{profile.analysis.interests.length > 0 && <div className="mt-5 flex flex-wrap gap-2">{profile.analysis.interests.map((interest) => <span key={interest} className="rounded-full bg-muted px-3 py-1 text-sm">{interest}</span>)}</div>}<h4 className="mt-7 font-bold">Conversation starters</h4><ul className="mt-3 space-y-2 text-sm text-muted-foreground">{profile.analysis.conversationStarters.map((starter) => <li key={starter}>• {starter}</li>)}</ul>{profile.analysis.warnings.length > 0 && <p className="mt-5 text-xs text-amber-700">Some social sources were unavailable: {profile.analysis.warnings.join(' ')}</p>}<p className="mt-5 text-xs text-muted-foreground">Generated {new Date(profile.analysis.generatedAt).toLocaleString('en-CA')} with {profile.analysis.model}.</p></div>}</section>
    {connections.length > 0 && <section className="mt-8"><h2 className="text-2xl font-black">Connections</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{connections.map((connection) => <Link key={connection.badgeId} href={`/people/${connection.badgeId}`} className="rounded-2xl border bg-card p-4 hover:border-primary"><p className="font-bold">{connection.name}</p><p className="font-mono text-xs text-muted-foreground">{connection.badgeId}</p></Link>)}</div></section>}
    <footer className="mt-10 text-xs leading-5 text-muted-foreground">First imported {new Date(profile.firstImportedAt).toLocaleString('en-CA')} · Last imported {new Date(profile.lastImportedAt).toLocaleString('en-CA')}. This public page requests no indexing by search engines.</footer>
  </main>
}
