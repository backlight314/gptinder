import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, ArrowUpRight, ContactRound, Sparkles, Users } from 'lucide-react'
import SiteNav from '@/components/site-nav'
import ProfileAvatar from '@/components/profile-avatar'
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
  return <div className="contact-row"><p>{label}</p>{href ? <a href={href} target="_blank" rel="noreferrer"><span>{value.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span><span className="contact-arrow" aria-hidden="true"><ArrowUpRight size={13} strokeWidth={2} /></span></a> : <p>{value}</p>}</div>
}

export default async function PersonPage({ params }: Props) {
  const { badgeId } = await params
  const profile = await getPublicProfile(badgeId)
  if (!profile) notFound()
  const connections = await listProfileConnections(profile.badgeId)
  const hasContacts = [profile.email, profile.phone, profile.linkedin, profile.instagram, profile.x, profile.discord].some(Boolean)
  return <main><SiteNav /><div className="shell profile-content">
    <Link href="/" className="back-link"><ArrowLeft size={14} /> Back to people</Link>
    <header className="glass-panel profile-heading">
      <div className="profile-cover" />
      <div className="profile-heading-body">
        <div className="profile-identity"><ProfileAvatar key={profile.avatarUrl} name={profile.name} src={profile.avatarUrl} alternatives={profile.avatarAlternatives} large /><span className="badge-label"><span className="live-dot" /> Badge imported</span></div>
        <h1>{profile.name}</h1><p className="person-role">{profile.role && !/^\d+$/.test(profile.role) ? profile.role : 'Hack the North participant'}</p><p className="badge-id">{profile.badgeId}</p>
        <div className="profile-stats"><span><strong>{profile.connectionCount}</strong> {profile.connectionCount === 1 ? 'connection' : 'connections'}</span><span><strong>{profile.observationCount}</strong> {profile.observationCount === 1 ? 'encounter' : 'encounters'} recorded</span></div>
      </div>
    </header>
    <div className="profile-columns">
      <section className="glass-panel profile-section"><h2 className="section-title"><ContactRound size={19} /> Keep in touch</h2><p className="section-intro">The details they shared on their badge.</p>
        <ContactLink label="Email" value={profile.email} href={profile.email ? `mailto:${profile.email}` : undefined} /><ContactLink label="Phone" value={profile.phone} href={profile.phone ? `tel:${profile.phone}` : undefined} /><ContactLink label="LinkedIn" value={profile.linkedin} href={profile.linkedin || undefined} /><ContactLink label="Instagram" value={profile.instagram} href={profile.instagram || undefined} /><ContactLink label="X / Twitter" value={profile.x} href={profile.x || undefined} /><ContactLink label="Discord" value={profile.discord} />
        {!hasContacts && <p className="analysis-empty">No contact links have been shared on this badge yet.</p>}
      </section>
      <section className="glass-panel profile-section"><h2 className="section-title"><Sparkles size={19} /> A little more about {profile.name.split(' ')[0]}</h2><p className="section-intro">Explore shared interests and find a thoughtful way to start your next conversation.</p><div className="mt-5"><ProfileAnalyzer badgeId={profile.badgeId} /></div>
        {profile.analysis ? <div className="analysis-body"><h3>{profile.analysis.headline}</h3><p>{profile.analysis.summary}</p>
          {profile.analysis.interests.length > 0 && <div className="interest-tags">{profile.analysis.interests.map(interest => <span key={interest}>{interest}</span>)}</div>}
          <h4>A conversation could start here</h4><ol className="starter-list">{profile.analysis.conversationStarters.map(starter => <li key={starter}>{starter.replace(/^[•\-]\s*/, '')}</li>)}</ol>
          {profile.analysis.warnings.length > 0 && <p>Some sources weren’t available. {profile.analysis.warnings.join(' ')}</p>}
          <p className="profile-meta">AI-generated · {new Date(profile.analysis.generatedAt).toLocaleDateString('en-CA')} · Based on available public profiles.</p>
        </div> : <div className="analysis-empty">Their story starts with a hello. Analyze the available social profiles to discover interests, conversation ideas, and a profile photo when available.</div>}
      </section>
    </div>
    {connections.length > 0 && <section className="mt-9"><h2 className="section-title"><Users size={19} /> People in their circle <span className="count-pill">{profile.connectionCount}</span></h2><div className="connection-list">{connections.map(connection => <Link key={connection.badgeId} href={`/people/${connection.badgeId}`} className="glass-panel connection-card"><ProfileAvatar name={connection.name} /><div><p>{connection.name}</p><p className="badge-id">{connection.badgeId}</p></div></Link>)}</div></section>}
    <footer className="profile-meta">First connected {new Date(profile.firstImportedAt).toLocaleDateString('en-CA')} · Updated {new Date(profile.lastImportedAt).toLocaleDateString('en-CA')}</footer>
  </div></main>
}
