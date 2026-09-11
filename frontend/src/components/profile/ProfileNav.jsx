import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, FileText, Grid, Image as ImageIcon, Sliders, Wallet,
  ShieldCheck, Lock, ChevDown, Check,
} from '../icons';
import { usePrefersReducedMotion } from '../../lib/motion';

/**
 * The Account Center's navigation.
 *
 * Nine sections, and the shape changes with the viewport because the right
 * answer genuinely differs:
 *
 *  - **Desktop** — a sticky rail. The sections are a stable list you move
 *    between while comparing; hiding them behind a menu would mean two clicks
 *    for every move.
 *  - **Phone** — a single button that opens the list as a sheet. A nine-item
 *    rail stacked above the content is most of a phone screen before any
 *    content appears, and a horizontally-scrolling tab strip hides items
 *    off-screen with no indication that they exist.
 *
 * The completeness meter lives here rather than in Overview alone, because the
 * thing it is asking you to do is always one click away in this list.
 */

export const SECTIONS = [
  {
    id: 'overview',
    label: 'Overview',
    icon: Grid,
    blurb: 'Everything brands see',
  },
  {
    id: 'personal',
    label: 'Personal Information',
    icon: Users,
    blurb: 'Name, bio, photo, location',
  },
  {
    id: 'social',
    label: 'Social Media',
    icon: Check,
    blurb: 'Instagram, Facebook, YouTube',
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    icon: ImageIcon,
    blurb: 'Work samples and your link',
  },
  {
    id: 'preferences',
    label: 'Work Preferences',
    icon: Sliders,
    blurb: 'Availability and what you make',
  },
  {
    id: 'rates',
    label: 'Rate Card',
    icon: FileText,
    blurb: 'What you charge',
  },
  {
    id: 'bank',
    label: 'Bank & Payments',
    icon: Wallet,
    blurb: 'Where payouts go',
    private: true,
  },
  {
    id: 'verification',
    label: 'Verification',
    icon: ShieldCheck,
    blurb: 'Your verified badge',
    private: true,
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Lock,
    blurb: 'Visibility and your account',
  },
];

export default function ProfileNav({ active, onSelect, completeness }) {
  const [open, setOpen] = useState(false);
  const reduced = usePrefersReducedMotion();
  const sheetRef = useRef(null);

  const current = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  // A section change closes the sheet; leaving it open over the new content is
  // how a phone menu ends up needing two taps to dismiss.
  useEffect(() => { setOpen(false); }, [active]);

  // Escape closes it, and the page behind must not scroll under it.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      {/* ── phone: the current section, tappable ── */}
      <div className="lg:hidden">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="profile-sections"
          className="w-full flex items-center gap-3 rounded-xl2 border border-line bg-white
                     px-4 py-3 shadow-flat focusable"
        >
          <span className="w-9 h-9 rounded-xl2 bg-gradient-to-br from-brand-500 to-pink-500
                           text-white grid place-items-center shrink-0">
            <current.icon className="w-4 h-4" />
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-sm font-semibold text-ink truncate">{current.label}</span>
            <span className="block text-[11px] text-muted truncate">{current.blurb}</span>
          </span>
          <ChevDown
            className={`w-4 h-4 text-muted shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {completeness && <CompletenessMeter {...completeness} className="mt-3" />}

        <AnimatePresence>
          {open && (
            <>
              <motion.div
                className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm"
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setOpen(false)}
              />
              <motion.nav
                id="profile-sections"
                ref={sheetRef}
                aria-label="Profile sections"
                className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-xl3 border-t border-line
                           shadow-lifted max-h-[80vh] overflow-y-auto p-3 pb-6"
                initial={reduced ? false : { y: '100%' }}
                animate={{ y: 0 }}
                exit={reduced ? { opacity: 0 } : { y: '100%' }}
                transition={{ duration: 0.26, ease: [0.2, 0.7, 0.3, 1] }}
              >
                <span className="block w-10 h-1 rounded-full bg-line mx-auto mb-3" aria-hidden="true" />
                {SECTIONS.map((s) => (
                  <NavItem
                    key={s.id}
                    section={s}
                    active={s.id === active}
                    onSelect={onSelect}
                  />
                ))}
              </motion.nav>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* ── desktop: the sticky rail ── */}
      <nav
        aria-label="Profile sections"
        className="hidden lg:block sticky top-6 self-start w-[260px] shrink-0"
      >
        <div className="rounded-xl3 border border-line bg-white shadow-flat p-2.5">
          {SECTIONS.map((s) => (
            <NavItem key={s.id} section={s} active={s.id === active} onSelect={onSelect} />
          ))}
        </div>

        {completeness && <CompletenessMeter {...completeness} className="mt-4" />}
      </nav>
    </>
  );
}

function NavItem({ section, active, onSelect }) {
  const Icon = section.icon;

  return (
    <button
      onClick={() => onSelect(section.id)}
      aria-current={active ? 'page' : undefined}
      className={`relative w-full flex items-center gap-3 rounded-xl2 px-3 py-2.5 text-left
                  transition-colors duration-200 focusable
                  ${active ? 'text-ink' : 'text-muted hover:text-ink hover:bg-bg'}`}
    >
      {/*
        The active wash is a layout-animated element rather than a class swap,
        so moving between sections slides the highlight instead of blinking it
        from one row to another.
      */}
      {active && (
        <motion.span
          layoutId="profile-nav-active"
          className="absolute inset-0 rounded-xl2 bg-gradient-to-r from-brand-50 to-pink-50
                     border border-brand-100"
          transition={{ duration: 0.22, ease: [0.2, 0.7, 0.3, 1] }}
        />
      )}

      <span
        className={`relative w-8 h-8 rounded-lg grid place-items-center shrink-0 transition-colors
                    ${active
                      ? 'bg-gradient-to-br from-brand-600 to-pink-600 text-white shadow-flat'
                      : 'bg-bg text-muted'}`}
      >
        <Icon className="w-4 h-4" />
      </span>

      <span className="relative min-w-0 flex-1">
        <span className={`block text-sm truncate ${active ? 'font-semibold' : 'font-medium'}`}>
          {section.label}
        </span>
        <span className="block text-[11px] text-muted truncate">{section.blurb}</span>
      </span>

      {/* A quiet mark on the two sections whose contents brands never see. */}
      {section.private && (
        <Lock className="relative w-3.5 h-3.5 text-muted/70 shrink-0" aria-label="Private" />
      )}
    </button>
  );
}

/**
 * The completeness meter.
 *
 * It names the single highest-value missing thing rather than listing all of
 * them: a list of ten outstanding items reads as a chore, one concrete next
 * step reads as a suggestion. `todo` is already ordered by weight, so the first
 * entry is the one that moves the number most.
 */
function CompletenessMeter({ percent, todo, onFix, className = '' }) {
  const next = todo?.[0];
  const complete = percent >= 100;

  return (
    <div
      className={`rounded-xl3 border border-line bg-gradient-to-br from-brand-50/80 to-pink-50/60
                  p-4 ${className}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">
          Profile strength
        </p>
        <p className="font-display font-extrabold text-lg text-ink tnum">{percent}%</p>
      </div>

      <div
        className="mt-2 h-2 rounded-full bg-white/80 overflow-hidden"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Profile completeness"
      >
        <motion.span
          className={`block h-full rounded-full ${
            complete
              ? 'bg-gradient-to-r from-jade-500 to-jade-600'
              : 'bg-gradient-to-r from-brand-500 to-pink-500'}`}
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.6, ease: [0.2, 0.7, 0.3, 1] }}
        />
      </div>

      {complete ? (
        <p className="text-xs text-jade-700 mt-2.5 leading-relaxed flex items-start gap-1.5">
          <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Your profile is complete.
        </p>
      ) : next ? (
        <div className="mt-2.5">
          <p className="text-xs text-ink-soft leading-relaxed">
            <span className="font-semibold text-ink">Next:</span> {next.label}
          </p>
          {onFix && (
            <button
              onClick={() => onFix(next.section)}
              className="text-xs font-semibold text-brand-700 hover:text-brand-800 mt-1.5 focusable"
            >
              Take me there →
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}