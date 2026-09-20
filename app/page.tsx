import Link from 'next/link'
import { ArrowUpRight, Search, Usb, Users, ArrowRight } from 'lucide-react'
import InteractiveHeart from '@/components/interactive-heart'
import SiteNav from '@/components/site-nav'
import ProfileAvatar from '@/components/profile-avatar'
import DemoReset from '@/components/demo-reset'
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
    <main className="directory-page">
      <SiteNav />
      <section className="directory-hero shell">
        <h1>A small hello.<br />A <span>real connection.</span></h1>
        <p className="hero-description">Good conversations deserve a next chapter. Bring the people you meet at Hack the North into one shared place.</p>
        <div className="hero-actions"><Link href="/import" className="primary-button">Bring your badge <ArrowUpRight size={18} /></Link><a href="#people" className="text-button">Explore the directory <ArrowRight size={16} /></a></div>
        <div className="hero-note"><InteractiveHeart label="Send love for real-world connections" /> Built around real-world connections.</div>
        <div className="hero-orbit"><div className="orbit-ring" aria-hidden="true" /><div className="orbit-ring inner" aria-hidden="true" /><InteractiveHeart large /><span className="orbit-label orbit-label-one" aria-hidden="true"><Users size={16} /> A familiar face</span><span className="orbit-label orbit-label-two" aria-hidden="true"><span className="live-dot" /> Stay connected</span><span className="orbit-star" aria-hidden="true">✳</span></div>
      </section>
      <section id="people" className="shell directory-content">
        <div className="directory-toolbar"><div><p className="eyebrow">YOUR NEXT CONVERSATION</p><h2>The people directory <span className="count-pill">{directory.total.toLocaleString()}</span></h2></div><form action="/" className="directory-search"><Search size={18} aria-hidden="true" /><input aria-label="Search by name or badge ID" name="q" defaultValue={query} maxLength={100} placeholder="Find someone you met…" /><button type="submit">Search</button></form></div>
        {query && <p className="search-summary">Results for “{query}” <Link href="/">Clear search</Link></p>}
        {!directory.configured && <div className="glass-panel empty-state"><h2>The directory is getting ready.</h2><p>Connect the database to start adding people.</p></div>}
        {error && <p role="alert" className="glass-panel p-5 text-destructive">{error}</p>}
        {directory.configured && !error && directory.profiles.length === 0 && <div className="glass-panel empty-state"><div className="empty-icon">{query ? <Search size={28} /> : <Usb size={28} />}</div><p className="eyebrow">{query ? 'KEEP LOOKING' : 'EVERY CONNECTION STARTS SOMEWHERE'}</p><h2>{query ? 'No one here by that name.' : 'Your first hello belongs here.'}</h2><p>{query ? 'Try another name or badge ID to find your person.' : 'Connect your badge, preview your contacts, and give those conversations a place to grow.'}</p><Link href={query ? '/' : '/import'} className="primary-button">{query ? 'View everyone' : 'Import your first badge'} <ArrowUpRight size={16} /></Link></div>}
        <div className="people-grid">
          {directory.profiles.map(profile => <Link key={profile.badgeId} href={`/people/${profile.badgeId}`} className="person-card glass-panel">
            <div className="person-card-top"><ProfileAvatar name={profile.name} /><span className="card-arrow"><ArrowUpRight size={18} /></span></div>
            <h3>{profile.name}</h3><p className="person-role">{profile.role && !/^\d+$/.test(profile.role) ? profile.role : 'Hack the North participant'}</p>
            <p className="badge-id">{profile.badgeId}</p>
            <div className="person-card-footer"><span><span className="live-dot" /> Badge imported</span><span>{socialCount(profile)} social link{socialCount(profile) === 1 ? '' : 's'}</span></div>
          </Link>)}
        </div>
        {pages > 1 && <nav aria-label="Directory pages" className="pagination"><Link aria-disabled={directory.page <= 1} className={directory.page <= 1 ? 'pointer-events-none opacity-40' : ''} href={`/?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(directory.page - 1) })}`}>← Previous</Link><span>{directory.page} / {pages}</span><Link aria-disabled={directory.page >= pages} className={directory.page >= pages ? 'pointer-events-none opacity-40' : ''} href={`/?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(directory.page + 1) })}`}>Next →</Link></nav>}
      </section>
      <footer className="site-footer shell"><span>hack the heart.</span><p>Less scrolling. More connecting.</p><div className="footer-actions"><DemoReset /><InteractiveHeart label="Send love from the footer" /></div></footer>
    </main>
  )
}
