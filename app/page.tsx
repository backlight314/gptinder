import Link from 'next/link'
import { listPublicProfiles } from '@/lib/airos-directory-store'

export const dynamic = 'force-dynamic'

type Props = { searchParams: Promise<{ q?: string; page?: string }> }

function socialCount(profile: { linkedin?: string | null; instagram?: string | null; x?: string | null }) {
  return [profile.linkedin, profile.instagram, profile.x].filter(Boolean).length
}

export default async function DirectoryPage({ searchParams }: Props) {
  const params = await searchParams
  const query = typeof params.q === 'string' ? params.q.slice(0, 100) : ''
  const requestedPage = Number(params.page || 1)
  let directory: Awaited<ReturnType<typeof listPublicProfiles>>
  let error = ''
  try {
    directory = await listPublicProfiles(query, requestedPage)
  } catch (caught) {
    console.error('Hack the Heart directory unavailable', caught)
    directory = { configured: true, profiles: [], total: 0, page: 1, pageSize: 24 }
    error = 'The directory is temporarily unavailable.'
  }
  const pages = Math.max(1, Math.ceil(directory.total / directory.pageSize))

  return (
    <main className="min-h-screen">
      <header className="border-b bg-card/80 backdrop-blur">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" className="text-xl font-black tracking-tight">Hack the Heart</Link>
          <div className="flex items-center gap-5 text-sm"><Link href="/lab" className="text-muted-foreground hover:text-foreground">AI Lab</Link><Link href="/import" className="rounded-full bg-primary px-5 py-2.5 font-bold text-primary-foreground">Import badge</Link></div>
        </nav>
      </header>
      <section className="mx-auto max-w-7xl px-5 pb-8 pt-16 sm:px-8 sm:pt-24">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-primary">Universal badge directory</p>
        <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div><h1 className="max-w-4xl text-5xl font-black tracking-[-0.04em] sm:text-7xl">People you met, in one shared place.</h1><p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">Read official Connect contacts from any compatible badge, preview them, then add missing people to the shared Hack the Heart directory.</p></div>
          <div className="rounded-3xl border bg-card p-6"><p className="text-4xl font-black">{directory.total.toLocaleString()}</p><p className="mt-1 text-sm text-muted-foreground">badge-imported profiles</p></div>
        </div>
        <form action="/" className="mt-12 flex max-w-2xl gap-3">
          <input name="q" defaultValue={query} maxLength={100} placeholder="Search by name or badge ID" className="min-w-0 flex-1 rounded-full border bg-card px-5 py-3 outline-none focus:ring-2 focus:ring-primary" />
          <button className="rounded-full border bg-card px-6 py-3 font-bold">Search</button>
        </form>
      </section>
      <section className="mx-auto max-w-7xl px-5 pb-20 sm:px-8">
        {!directory.configured && <div className="rounded-3xl border border-dashed p-10 text-center"><h2 className="text-xl font-bold">Directory setup is waiting for MongoDB.</h2><p className="mt-2 text-muted-foreground">Configure the server database, then import a badge to create the first profiles.</p></div>}
        {error && <p className="rounded-2xl bg-destructive/10 p-4 text-destructive">{error}</p>}
        {directory.configured && !error && directory.profiles.length === 0 && <div className="rounded-3xl border border-dashed p-10 text-center"><h2 className="text-xl font-bold">{query ? 'No matching profiles.' : 'No profiles yet.'}</h2><p className="mt-2 text-muted-foreground">{query ? 'Try a different name or badge ID.' : 'Connect a badge to preview and import its official contacts.'}</p><Link href="/import" className="mt-6 inline-block rounded-full bg-primary px-6 py-3 font-bold text-primary-foreground">Import a badge</Link></div>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {directory.profiles.map((profile) => <Link key={profile.badgeId} href={`/people/${profile.badgeId}`} className="group rounded-3xl border bg-card p-6 transition hover:-translate-y-1 hover:shadow-lg">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold group-hover:text-primary">{profile.name}</h2><p className="mt-1 font-mono text-xs text-muted-foreground">{profile.badgeId}</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">badge imported</span></div>
            <p className="mt-6 text-sm text-muted-foreground">{profile.role || 'Hack the North participant'}</p>
            <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground"><span>{socialCount(profile)} social link{socialCount(profile) === 1 ? '' : 's'}</span><span>Updated {profile.lastImportedAt instanceof Date ? profile.lastImportedAt.toLocaleDateString('en-CA') : 'recently'}</span></div>
          </Link>)}
        </div>
        {pages > 1 && <nav aria-label="Directory pages" className="mt-10 flex items-center justify-center gap-4 text-sm"><Link aria-disabled={directory.page <= 1} className={directory.page <= 1 ? 'pointer-events-none opacity-40' : 'font-bold'} href={`/?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(directory.page - 1) })}`}>← Previous</Link><span>Page {directory.page} of {pages}</span><Link aria-disabled={directory.page >= pages} className={directory.page >= pages ? 'pointer-events-none opacity-40' : 'font-bold'} href={`/?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(directory.page + 1) })}`}>Next →</Link></nav>}
      </section>
    </main>
  )
}
