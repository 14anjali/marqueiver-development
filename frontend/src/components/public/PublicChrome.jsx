import { useState, useEffect } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Logo } from '../ui';
import { Menu, X } from '../icons';
import { useAuth } from '../../lib/auth';
import { motion, useReducedMotion, EASE } from './motion';

/**
 * Chrome for the public marketing site.
 *
 * A signed-in visitor who lands back here gets "Go to dashboard" rather than
 * Login/Sign up — the site never asks someone to log into an account they are
 * already using.
 *
 * Every link below points at a route that exists in App.jsx. Marketing navs
 * accumulate aspirational links to pages nobody built; each of these was checked
 * against the router.
 */

const LINKS = [
  { to: '/how-it-works', label: 'How it works' },
  { to: '/for-creators', label: 'For creators' },
  { to: '/for-brands', label: 'For brands' },
  { to: '/faq', label: 'FAQ' },
];

export function PublicNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { isAuthed } = useAuth();
  const loc = useLocation();
  const reduce = useReducedMotion();

  /**
   * The bar starts transparent over the hero and gains its glass once the page
   * moves, so the hero is not cut off by a hard edge at rest. `passive` because
   * this listener must never be able to block a scroll.
   */
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // A route change should not leave the mobile sheet hanging open.
  useEffect(() => { setOpen(false); }, [loc.pathname]);

  // The sheet covers the page, so the page behind it must not scroll.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <header
      className={`sticky top-0 z-40 transition-[background-color,border-color,box-shadow] duration-300
                  ${scrolled
                    ? 'bg-white/80 border-b border-line shadow-flat backdrop-blur-xl'
                    : 'bg-transparent border-b border-transparent'}`}
    >
      <div className="container-wide h-[4.5rem] flex items-center justify-between gap-6">
        <Link to="/" className="shrink-0" aria-label="Marqueiver home">
          <Logo />
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm" aria-label="Main">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `link-slide font-medium transition-colors ${
                  isActive ? 'text-brand-700' : 'text-ink-soft hover:text-ink'}`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-2">
          {isAuthed ? (
            <Link to="/dashboard" className="btn-liquid !px-6 !py-2.5 !text-sm">Go to dashboard</Link>
          ) : (
            <>
              <Link
                to="/login"
                className="link-slide text-sm font-semibold text-ink px-3 py-2 hover:text-brand-700 transition-colors"
              >
                Log in
              </Link>
              <Link to="/signup" className="btn-liquid !px-6 !py-2.5 !text-sm">Get started</Link>
            </>
          )}
        </div>

        <button
          className="md:hidden p-2 -mr-2 text-ink rounded-lg focus-visible:outline-none
                     focus-visible:ring-2 focus-visible:ring-brand-500"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
        >
          {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-menu"
            className="md:hidden fixed inset-x-0 top-[4.5rem] bottom-0 z-40 bg-white/95 backdrop-blur-xl
                       border-t border-line overflow-y-auto"
            initial={reduce ? false : { opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12 }}
            transition={{ duration: 0.22, ease: EASE }}
          >
            <nav className="container-wide py-6 space-y-1" aria-label="Mobile">
              {LINKS.map((l, i) => (
                <motion.div
                  key={l.to}
                  initial={reduce ? false : { opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.04 * i, duration: 0.25, ease: EASE }}
                >
                  <Link
                    to={l.to}
                    className={`block py-3.5 text-lg font-medium border-b border-line/70 ${
                      loc.pathname === l.to ? 'text-brand-700' : 'text-ink'}`}
                  >
                    {l.label}
                  </Link>
                </motion.div>
              ))}

              <div className="pt-6 grid gap-3">
                {isAuthed ? (
                  <Link to="/dashboard" className="btn-liquid w-full">Go to dashboard</Link>
                ) : (
                  <>
                    <Link to="/signup" className="btn-liquid w-full">Get started</Link>
                    <Link to="/login" className="btn-liquid-ghost w-full">Log in</Link>
                  </>
                )}
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="liquid-stage liquid-stage--ink text-white relative">
      <div className="container-wide relative z-10 py-16 md:py-20 grid gap-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo tone="light" />
          <p className="text-sm text-white/60 mt-5 max-w-sm leading-relaxed">
            Creator collaborations with the terms on the record and the payment held in escrow
            until the work is approved.
          </p>
          <div className="flex flex-wrap gap-3 mt-7">
            <Link to="/signup?role=creator" className="btn-liquid !px-5 !py-2.5 !text-sm">
              Join as a creator
            </Link>
            <Link
              to="/signup?role=brand"
              className="btn-liquid-ghost btn-liquid-ghost-ink !px-5 !py-2.5 !text-sm"
            >
              Join as a brand
            </Link>
          </div>
        </div>

        <FooterColumn
          title="Product"
          links={[
            ['/how-it-works', 'How it works'],
            ['/for-creators', 'For creators'],
            ['/for-brands', 'For brands'],
            ['/faq', 'FAQ'],
          ]}
        />
        <FooterColumn
          title="Legal"
          links={[
            ['/terms', 'Terms & Conditions'],
            ['/privacy', 'Privacy Policy'],
            ['/policies', 'All platform policies'],
            ['/login', 'Log in'],
          ]}
        />
      </div>

      <div className="border-t border-white/10 relative z-10">
        <div className="container-wide py-6 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between
                        text-xs text-white/45">
          <p>© 2026 Marqueiver · Dahmion Technologies</p>
          <p>New Delhi, India</p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-white mb-4">{title}</h3>
      <ul className="space-y-2.5 text-sm text-white/55">
        {links.map(([to, label]) => (
          <li key={to}>
            <Link to={to} className="link-slide hover:text-white transition-colors">{label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Wrapper so every public page gets identical chrome and skip-link behaviour. */
export function PublicLayout({ children }) {
  return (
    <div className="min-h-screen flex flex-col bg-white overflow-x-clip">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:px-4 focus:py-2
                   focus:bg-ink focus:text-white focus:rounded-lg"
      >
        Skip to content
      </a>
      <PublicNav />
      <main id="main" className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}
