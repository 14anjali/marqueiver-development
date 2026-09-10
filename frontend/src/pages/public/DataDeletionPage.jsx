import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { PublicLayout } from '../../components/public/PublicChrome';
import { Skeleton, SkeletonText, StatusPill, SuccessMark } from '../../components/feedback';
import { rise, withReducedMotion, usePrefersReducedMotion } from '../../lib/motion';
import { api } from '../../lib/api';

/**
 * The page behind the URL Marqueiver hands back to Meta's Data Deletion callback.
 *
 * Meta's requirement is that a person who asks Facebook or Instagram to delete
 * their data gets a URL and a confirmation code, and that the URL explains the
 * status of that request. This is that page.
 *
 * It is public and unauthenticated on purpose. The person arriving here has just
 * removed the app; requiring them to sign in to find out whether their deletion
 * happened would be exactly the wrong shape. The confirmation code is the only
 * credential, and the endpoint behind it returns nothing that identifies an
 * account — platform, timestamps and a status, and that is all.
 *
 * The code can also be typed in, because these links get copied into notes and
 * emails and arrive with the query string stripped more often than not.
 *
 * ── What this pass fixed ────────────────────────────────────────────────────
 *
 *  1. **A request in progress never updated.** The page fetched once and the
 *     copy then told the reader to "come back to this page in a few minutes" —
 *     the product asking the user to be its polling loop, on the one page where
 *     the person is anxious and has no account to log into. It now re-checks
 *     itself while the status is `received`, backing off as it goes, and says
 *     when it last looked. Polling stops the moment the request closes, when
 *     the tab is hidden, and after ten minutes, because a page left open on a
 *     phone must not sit there hitting a rate-limited endpoint forever.
 *  2. **Three private colour scales.** The card carried its own
 *     `emerald` / `amber` / `rose` map, none of which are Marqueiver colours —
 *     jade confirms, ochre waits, rose warns, and `StatusPill` is the one place
 *     that decides which. A deletion "completed" was a different green from
 *     every other completed thing in the product.
 *  3. **The loading state was the sentence "Looking up ABC123…".** The card
 *     then appeared at full height and shoved the page down. It is a skeleton
 *     shaped like the result now.
 *  4. The page was written in the previous public vocabulary
 *     (`container-page`, `h-display`) under the rebuilt glass nav.
 */

const PLATFORM_LABEL = {
  facebook: 'Facebook',
  instagram: 'Instagram',
};

/**
 * Marqueiver's own status vocabulary for these four backend states.
 *
 * `StatusPill` maps deal states; these are deletion-request states, so the
 * mapping onto the shared vocabulary happens here — but the *colours* still
 * come from the pill, which is the point. `completed` and `no_data_found` are
 * both "finished, nothing to do", `received` is "waiting on us", `failed` is
 * "needs attention".
 */
const STATUS_COPY = {
  completed: {
    pill: 'completed',
    pillLabel: 'Request closed',
    done: true,
    title: 'Your data has been deleted',
    body: 'We removed the connection and everything we had received from this account — the '
      + 'access tokens, the synced profile details and audience numbers, and the copy shown on '
      + 'your Marqueiver profile.',
  },
  no_data_found: {
    pill: 'completed',
    pillLabel: 'Request closed',
    done: true,
    title: 'There was nothing to delete',
    body: 'We received your request and checked. This account was not connected to Marqueiver, '
      + 'so we held no data from it. Nothing further is needed.',
  },
  received: {
    pill: 'pending_review',
    pillLabel: 'In progress',
    done: false,
    title: 'Your request is being processed',
    body: 'We have your request and are working through it. This page checks for you — you do '
      + 'not need to reload it.',
  },
  failed: {
    pill: 'disputed',
    pillLabel: 'Needs attention',
    done: true,
    title: 'Your request did not complete',
    body: 'Something went wrong on our side while processing this request. Our team can see it '
      + 'and will finish it — quote the confirmation code below if you contact us.',
  },
};

const fmt = (d) => (d
  ? new Date(d).toLocaleString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  : null);

const clock = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');

/**
 * How long to wait before the next check, given how many we have already made.
 *
 * Short at first, because most requests close within a minute or two and the
 * person is watching. Then it backs off: someone who leaves this tab open
 * should not be sending a request every five seconds to an endpoint that is
 * deliberately rate-limited to twenty a minute.
 */
const POLL_DELAYS_MS = [5_000, 5_000, 10_000, 10_000, 20_000, 30_000, 60_000];
const nextDelay = (n) => POLL_DELAYS_MS[Math.min(n, POLL_DELAYS_MS.length - 1)];
const MAX_POLL_MS = 10 * 60 * 1000;

export default function DataDeletionPage() {
  const [params, setParams] = useSearchParams();
  const code = (params.get('code') || '').trim().toUpperCase();

  const [typed, setTyped] = useState('');
  const [record, setRecord] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [checkedAt, setCheckedAt] = useState(null);
  const [rechecking, setRechecking] = useState(false);

  const reduced = usePrefersReducedMotion();

  const alive = useRef(true);
  const timer = useRef(null);
  const attempts = useRef(0);
  const startedAt = useRef(0);

  const clearTimer = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };

  /**
   * One lookup. `background: true` means "we already have something on screen"
   * — the card stays put and only a small indicator moves, so a poll never
   * blanks a result the person is reading.
   */
  const check = useCallback(async (background = false) => {
    if (!code) return;
    if (background) setRechecking(true); else setLoading(true);

    try {
      const { data } = await api.dataDeletionStatus(code);
      if (!alive.current) return;
      setRecord(data);
      setError(null);
      setCheckedAt(Date.now());
    } catch (e) {
      if (!alive.current) return;
      // A failed *background* check is not worth replacing a good result with
      // an error — the next one will very likely succeed, and the person is
      // reading a status, not debugging our network.
      if (!background) setError(e);
    } finally {
      if (alive.current) { setLoading(false); setRechecking(false); }
    }
  }, [code]);

  /* First lookup whenever the code changes. */
  useEffect(() => {
    alive.current = true;
    clearTimer();
    attempts.current = 0;
    startedAt.current = Date.now();
    setRecord(null);
    setError(null);
    setCheckedAt(null);

    if (code) check(false);

    return () => { alive.current = false; clearTimer(); };
  }, [code, check]);

  /* Keep checking while the request is still open. */
  useEffect(() => {
    clearTimer();
    if (!record || record.status !== 'received') return undefined;
    if (Date.now() - startedAt.current > MAX_POLL_MS) return undefined;

    // A hidden tab has no reader, so it has no reason to poll. The visibility
    // listener restarts it when the person comes back.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      const onVisible = () => { if (document.visibilityState === 'visible') check(true); };
      document.addEventListener('visibilitychange', onVisible);
      return () => document.removeEventListener('visibilitychange', onVisible);
    }

    timer.current = setTimeout(() => {
      attempts.current += 1;
      check(true);
    }, nextDelay(attempts.current));

    return clearTimer;
  }, [record, checkedAt, check]);

  const copy = record ? (STATUS_COPY[record.status] ?? STATUS_COPY.received) : null;
  const stillOpen = record?.status === 'received';
  const gaveUp = stillOpen && Date.now() - startedAt.current > MAX_POLL_MS;

  return (
    <PublicLayout>
      <section className="liquid-stage pt-10 pb-24 md:pt-16 -mt-[4.5rem]">
        <div
          className="pointer-events-none absolute -top-40 -left-32 w-[38rem] h-[38rem] rounded-full opacity-[0.35] animate-liquid"
          style={{
            background: 'radial-gradient(circle, rgba(167,139,250,.38) 0%, transparent 65%)',
            filter: 'blur(64px)',
          }}
        />

        <div className="container-wide relative z-10 pt-[4.5rem]">
          <div className="max-w-2xl">
            <h1 className="display-hero text-ink">Data deletion request</h1>
            <p className="text-lg text-ink-soft mt-6 leading-relaxed">
              When you ask Facebook or Instagram to delete the data an app holds about you, they
              tell us, and we act on it. This page shows what happened to your request.
            </p>

            {/* No code in the URL — let people type the one they were given. */}
            {!code && (
              <form
                className="card-edge mt-10 p-6 md:p-8"
                onSubmit={(e) => {
                  e.preventDefault();
                  const next = typed.trim().toUpperCase();
                  if (next) setParams({ code: next });
                }}
              >
                <label htmlFor="dd-code" className="field-label">
                  Confirmation code
                </label>
                <p className="mt-1 text-sm text-muted">
                  Facebook or Instagram showed you this code when your request was made.
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <input
                    id="dd-code"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder="e.g. K3M9QP2XA7BD"
                    autoComplete="off"
                    spellCheck={false}
                    className="field flex-1 font-mono uppercase tracking-wider"
                  />
                  <button type="submit" className="btn-brand" disabled={!typed.trim()}>
                    Check status
                  </button>
                </div>
              </form>
            )}

            {/*
              Shaped like the card it becomes, so the page does not jump when the
              answer arrives — which matters here more than usual, because the
              answer is the only thing on the page the person came for.
            */}
            {loading && (
              <div
                className="card-edge mt-10 p-6 md:p-8"
                aria-busy="true"
                aria-live="polite"
                aria-label={`Looking up ${code}`}
              >
                <Skeleton className="h-6 w-28 rounded-full" />
                <Skeleton className="h-7 w-3/4 max-w-sm rounded-lg mt-5" />
                <SkeletonText lines={2} className="mt-4" />
                <div className="mt-7 grid gap-4 border-t border-line pt-6 sm:grid-cols-2">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i}>
                      <Skeleton className="h-3 w-24 rounded" />
                      <Skeleton className="h-4 w-36 max-w-full rounded mt-2" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* A code that matches nothing. Deliberately says nothing about why. */}
            {!loading && code && error && (
              <div className="card-edge mt-10 p-6 md:p-8" role="alert">
                <h2 className="font-display font-bold text-lg text-ink">
                  We could not find that code
                </h2>
                <p className="mt-3 text-muted leading-relaxed">
                  {error.status === 404
                    ? 'No deletion request matches this confirmation code. Check it for typos — '
                      + 'it is twelve characters, letters and digits.'
                    : 'We could not check the status right now. Please try again in a moment.'}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button type="button" className="btn-outline" onClick={() => check(false)}>
                    Try again
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => { setParams({}); setTyped(code); }}
                  >
                    Enter a different code
                  </button>
                </div>
              </div>
            )}

            {!loading && record && copy && (
              <motion.div
                variants={withReducedMotion(rise, reduced)}
                initial="hidden"
                animate="visible"
                className="card-edge mt-10 p-6 md:p-8"
              >
                <div className="flex items-start justify-between gap-4">
                  {/*
                    The one status→colour authority in the product decides this,
                    rather than a private emerald/amber/rose map that agreed with
                    nothing else on the site.
                  */}
                  <StatusPill status={copy.pill} label={copy.pillLabel} />

                  {stillOpen && !gaveUp && (
                    <span
                      className="text-xs text-muted flex items-center gap-1.5 shrink-0"
                      aria-live="polite"
                    >
                      {rechecking
                        ? <><span className="dot-live" aria-hidden="true" />Checking…</>
                        : checkedAt ? `Last checked ${clock(checkedAt)}` : null}
                    </span>
                  )}
                </div>

                {/*
                  The tick is reserved for something irreversible having gone
                  right, and a completed deletion is exactly that.
                */}
                {copy.done && record.status !== 'failed' && (
                  <SuccessMark className="w-11 h-11 mt-6" />
                )}

                <h2 className="mt-5 font-display font-extrabold text-xl md:text-2xl text-ink">
                  {copy.title}
                </h2>
                <p className="mt-3 text-muted leading-relaxed">{copy.body}</p>

                {gaveUp && (
                  <p className="mt-4 text-sm text-muted leading-relaxed">
                    This has been open for a while, so we have stopped checking automatically.
                    {' '}
                    <button
                      type="button"
                      className="font-medium text-brand-700 underline underline-offset-2"
                      onClick={() => { startedAt.current = Date.now(); attempts.current = 0; check(true); }}
                    >
                      Check again
                    </button>
                    , or contact us quoting the code below.
                  </p>
                )}

                <dl className="mt-7 grid gap-4 border-t border-line pt-6 sm:grid-cols-2">
                  <Field label="Platform" value={PLATFORM_LABEL[record.platform] ?? record.platform} />
                  <Field
                    label="Confirmation code"
                    value={record.confirmationCode}
                    className="font-mono tracking-wider"
                  />
                  <Field label="Requested" value={fmt(record.requestedAt) ?? '—'} />
                  <Field label="Completed" value={fmt(record.completedAt) ?? 'Not yet'} />
                </dl>
              </motion.div>
            )}

            {/*
              The honest part. People reading this page are entitled to know that
              "delete my Facebook data" is not the same request as "delete my
              Marqueiver account", and where the second one lives.
            */}
            <div className="surface-over mt-10 p-6 md:p-8 rounded-xl2">
              <h2 className="font-display font-bold text-lg text-ink">What this covers</h2>
              <p className="mt-3 text-muted leading-relaxed">
                A request from Facebook or Instagram removes the data we received from that
                platform: the access tokens, the profile and audience details we synced, and the
                copy of them shown on your Marqueiver profile.
              </p>
              <p className="mt-3 text-muted leading-relaxed">
                It does not close your Marqueiver account. Your collaborations, messages and payment
                records stay as they are — we are required to keep transaction records for tax and
                accounting, and deleting them because you unlinked a social account would take your
                earnings history with it.
              </p>
              <p className="mt-3 text-muted leading-relaxed">
                To close your account entirely, sign in and use{' '}
                <Link to="/profile" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Profile → Delete account</Link>, or read the{' '}
                <Link to="/privacy" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Privacy Policy</Link> for what we keep and for
                how long.
              </p>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

function Field({ label, value, className = '' }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`mt-1 font-medium text-ink ${className}`}>{value}</dd>
    </div>
  );
}
