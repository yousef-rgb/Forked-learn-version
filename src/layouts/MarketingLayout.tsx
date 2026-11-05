import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Code2, ExternalLink, Menu, X } from 'lucide-react'
import { ThemeToggle } from '../components/ThemeToggle'
import { ButtonLink, PixelIcon } from '../components/ui'
import { useAuth } from '../store/auth'
import { useI18n } from '../i18n'
import { LangToggle } from '../components/LangToggle'

export function Logo({ to = '/' }: { to?: string }) {
  const { t } = useI18n()
  return (
  <Link to={to} className="logo" aria-label={t('Forked Learn home')}>
    <PixelIcon name="flag" size={30} />
    <span>Forked Learn</span>
  </Link>
  )
}

const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#paths', label: 'Paths' },
  { href: '#journey', label: 'Journey' },
  { href: '#gamification', label: 'Rewards' },
  { href: '#faq', label: 'FAQ' },
]

export function MarketingLayout() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const { user } = useAuth()
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname, loc.hash])
  useEffect(() => {
    if (loc.hash) { const el = document.querySelector(loc.hash); el?.scrollIntoView() }
    else window.scrollTo(0, 0)
  }, [loc.hash, loc.pathname])

  return (
    <>
      <a className="skip-link" href="#main">{t('Skip to content')}</a>
      <header className="mnav">
        <div className="container mnav__inner">
          <Logo />
          <nav className="mnav__links" aria-label={t('Primary')}>
            {LINKS.map((l) => <Link key={l.href} to={`/${l.href}`} onClick={() => { if (loc.pathname === '/') document.querySelector(l.href)?.scrollIntoView({ behavior: 'smooth' }) }}>{t(l.label)}</Link>)}
          </nav>
          <div className="mnav__actions">
            <LangToggle />
            <ThemeToggle />
            {user ? <ButtonLink to="/app" variant="primary" size="sm">{t('Continue quest')}</ButtonLink> : <>
              <NavLink to="/login" className="mnav__login">{t('Log in')}</NavLink>
              <ButtonLink to="/signup" variant="primary" size="sm">{t('Start journey')}</ButtonLink>
            </>}
            <button className="icon-btn mnav__burger" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? t('Close menu') : t('Open menu')}>{open ? <X size={20} /> : <Menu size={20} />}</button>
          </div>
        </div>
        {open && (
          <div id="mobile-menu" className="mnav__drawer">
            {LINKS.map((l) => <Link key={l.href} to={`/${l.href}`}>{t(l.label)}</Link>)}
            {!user && <Link to="/login">{t('Log in')}</Link>}
            <ButtonLink to={user ? '/app' : '/signup'} variant="primary">{user ? t('Continue quest') : t('Start your journey')}</ButtonLink>
          </div>
        )}
      </header>
      <main id="main"><Outlet /></main>
      <footer className="footer">
        <div className="container footer__grid">
          <div className="footer__brand">
            <Logo />
            <p className="muted">{t('Learn to code. Think like an engineer. A gamified path through computer science, Python and JavaScript.')}</p>
            <p className="muted" style={{ fontSize: '0.8rem' }}>{t('Inspired by GDG on Campus CHI · 2026–2027.')}</p>
          </div>
          <div><h4>{t('Learn')}</h4><Link to="/signup">{t('Computer Science')}</Link><Link to="/signup">Python</Link><Link to="/signup">JavaScript</Link></div>
          <div><h4>{t('Explore')}</h4><Link to="/#how">{t('How it works')}</Link><Link to="/#gamification">{t('Rewards')}</Link><Link to="/#faq">{t('FAQ')}</Link></div>
          <div><h4>{t('Account')}</h4><Link to="/login">{t('Log in')}</Link><Link to="/signup">{t('Sign up')}</Link><Link to="/forgot-password">{t('Forgot password')}</Link></div>
        </div>
        <div className="container footer__bar"><span>© 2026 Forked Learn.</span><a className="btn btn--sm devbtn" href="https://yousef-rgb.github.io/jou/" target="_blank" rel="noopener noreferrer" aria-label="Developer: Yousef Mohamed El-Tayel (opens in a new tab)"><Code2 size={14} /> Developed by Yousef Mohamed El-Tayel <ExternalLink size={13} /></a></div>
        <div className="grass" aria-hidden="true" />
      </footer>
    </>
  )
}
