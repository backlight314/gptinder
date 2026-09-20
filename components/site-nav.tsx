'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Heart, Users, Sparkles } from 'lucide-react'

export default function SiteNav() {
  const pathname = usePathname() || '/'
  return <header className="site-nav-wrap"><nav aria-label="Main navigation" className="site-nav">
    <Link href="/" className="brand"><span className="brand-mark"><Heart size={19} fill="currentColor" /></span><span>hack the heart<span className="brand-dot">.</span></span></Link>
    <div className="nav-links"><Link href="/" aria-current={pathname === '/' || pathname.startsWith('/people/') ? 'page' : undefined}><Users size={15} /> People</Link><Link href="/lab" aria-current={pathname === '/lab' ? 'page' : undefined}><Sparkles size={15} /> AI Lab</Link></div>
    <Link href="/import" className="nav-import" aria-current={pathname === '/import' ? 'page' : undefined}>Import badge <svg className="import-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8" /></svg></Link>
  </nav></header>
}
