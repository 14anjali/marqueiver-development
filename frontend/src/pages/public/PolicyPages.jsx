import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { PublicLayout } from '../../components/public/PublicChrome';
import { Skeleton, SkeletonText } from '../../components/feedback';
import { Drawer } from '../../components/overlay';
import { ErrorBlock } from '../../lib/ui-state';
import { ChevLeft, List } from '../../components/icons';
import { api } from '../../lib/api';

/**
 * The policy pages.
 *
 * These used to render a notice saying the text was "available on request",
 * because the seeded policy rows had an empty body. A person was being asked to
 * accept documents they could not read. The full Marqueiver Platform Policies
 * now ship with the server, and this renders them properly:
 *
 *  - **Structure, not a wall of pre-wrapped text.** Headings are headings, lists
 *    are lists, and the rate tables in Policy 7.1 and 14.2 are tables — those are
 *    numbers a user is agreeing to, and flattening them to prose loses the
 *    correspondence between a stage and its refund.
 *  - **Version and effective date up front**, because acceptance is recorded
 *    against a specific version and the reader is entitled to know which.
 *  - **A contents rail** with the current section tracked as you scroll. Fifteen
 *    sections of terms is not something anyone reads top to bottom; people arrive
 *    looking for one clause.
 *  - **Deep links.** Every section has an id, so `/terms#s-1-3` opens the
 *    eligibility clause directly — which is what support and disputes need.
 *
 * ── What this pass fixed ────────────────────────────────────────────────────
 *
 *  1. **The loading skeleton rendered at zero width.** It built class names by
 *     interpolation — `` `h-6 w-${w} rounded-full` `` — and Tailwind only emits
 *     classes it can see as complete literals in the source. `w-20` was never
 *     generated, so those three pills had no width and the skeleton was three
 *     invisible elements. Constructed class names are the single most common
 *     way a Tailwind UI silently loses styling; every width here is a literal
 *     now, and the shared `Skeleton` carries the shimmer.
 *  2. **The contents rail was `hidden lg:block`.** On a phone — where most
 *     people follow a policy link from a signup form — a fifteen-section legal
 *     document had no navigation at all, only a very long scroll. The same
 *     sections now open in the shared `Drawer`, which traps focus and restores
 *     it, rather than in a second hand-rolled sheet.
 *  3. **Hand-rolled error and shimmer markup** replaced with the system's
 *     `ErrorBlock` and `Skeleton`, so a policy failing to load looks like
 *     everything else failing to load, and gets the same retry.
 *  4. **"of 15" was a literal.** It comes from the server's catalogue now.
 *  5. The page was still written in the previous public vocabulary
 *     (`container-page`, `h-display`) under the rebuilt glass nav.
 */

const fmtDate = (d) => (d
  ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  : '');

const sectionId = (s) => `s-${String(s.number || s.heading).replace(/[^\w]+/g, '-').toLowerCase()}`;

/* ─────────────────────────────── index page ───────────────────────────────── */

export function PolicyIndexPage() {
  const [policies, setPolicies] = useState(null);
  const [error, setError] = useState(null);

  // `nonce` re-runs the effect on retry, so the retry path is the same code as
  // the first load rather than a second copy that can drift from it.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    setPolicies(null);
    api.listPolicies()
      .then(({ data }) => alive && setPolicies(data ?? []))
      .catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, [nonce]);

  return (
    <PublicLayout>
      <section className="liquid-stage pt-10 pb-10 md:pt-16 -mt-[4.5rem]">
        <div
          className="pointer-events-none absolute -top-40 -left-32 w-[40rem] h-[40rem] rounded-full opacity-[0.4] animate-liquid"
          style={{
            background: 'radial-gradient(circle, rgba(167,139,250,.4) 0%, transparent 65%)',
            filter: 'blur(64px)',
          }}
        />
        <div className="container-wide relative z-10 pt-[4.5rem]">
          <h1 className="display-hero text-ink max-w-3xl">Platform policies</h1>
          <p className="text-lg text-ink-soft mt-6 max-w-2xl leading-relaxed">
            These policies govern how Marqueiver works — for creators, for brands, and for the money in
            between. Each one is versioned, and we record which version you accepted and when.
          </p>
          {policies?.length > 0 && (
            <p className="mt-5 text-sm text-muted tnum">
              {policies.length} policies · version {policies[0].version} ·
              in effect from {fmtDate(policies[0].effectiveFrom)}
            </p>
          )}
        </div>
      </section>

      <section className="container-wide pb-24">
        {error ? (
          <div className="max-w-2xl"><ErrorBlock error={error} onRetry={() => setNonce((n) => n + 1)} /></div>
        ) : !policies ? (
          <ul
            className="divide-y divide-line border-y border-line"
            aria-busy="true"
            aria-live="polite"
            aria-label="Loading policies"
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="py-5 flex items-center gap-4">
                <Skeleton className="h-5 w-8 rounded" />
                <div className="flex-1 min-w-0">
                  <Skeleton className="h-4 w-56 max-w-full rounded" />
                  <Skeleton className="h-3 w-40 max-w-full mt-2 rounded" />
                </div>
                <Skeleton className="h-4 w-12 rounded" />
              </li>
            ))}
          </ul>
        ) : !policies.length ? (
          <div className="rounded-xl2 border border-line bg-bg p-10 text-center">
            <p className="text-sm text-muted">No policies have been published yet.</p>
          </div>
        ) : (
          <ol className="divide-y divide-line border-y border-line">
            {policies.map((p) => (
              <li key={p.slug}>
                <Link
                  to={p.route ?? `/policies/${p.slug}`}
                  className="flex items-center gap-4 py-5 group rounded-lg px-2 -mx-2 focusable
                             transition-colors hover:bg-bg"
                >
                  <span className="w-8 shrink-0 font-display font-extrabold text-muted tnum">
                    {String(p.number ?? '').padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display font-bold text-ink group-hover:text-brand-700 transition-colors">
                      {p.title}
                    </span>
                    <span className="block text-xs text-muted mt-1">
                      {p.sectionCount} sections · applies to{' '}
                      {p.requiredFor?.length === 2 ? 'creators and brands' : `${p.requiredFor?.[0]}s`}
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-brand-700 shrink-0">Read</span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </PublicLayout>
  );
}

/* ─────────────────────────────── detail page ──────────────────────────────── */

/**
 * `route` is passed by the dedicated routes (/terms, /privacy, …); `:slug` is
 * used by /policies/:slug. Either resolves server-side, so the two URL shapes
 * cannot drift apart.
 */
export function PolicyDetailPage({ route }) {
  const params = useParams();
  const nav = useNavigate();
  const key = route ?? params.slug;

  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [contentsOpen, setContentsOpen] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setPolicy(null);
    setError(null);
    api.getPolicy(key)
      .then(({ data }) => {
        if (!alive) return;
        setPolicy(data);
        // Honour a deep link once the sections exist to scroll to.
        if (window.location.hash) {
          requestAnimationFrame(() => {
            document.getElementById(window.location.hash.slice(1))
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        } else {
          window.scrollTo({ top: 0 });
        }
      })
      .catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, [key]);

  /* Track the section in view for the contents rail. */
  useEffect(() => {
    if (!policy || !bodyRef.current) return undefined;
    const headings = bodyRef.current.querySelectorAll('[data-section]');
    if (!headings.length) return undefined;

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      // The top band only: a section counts as "current" once its heading is
      // near the top of the viewport, which is where a reader's eye is.
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    );
    headings.forEach((h) => io.observe(h));
    return () => io.disconnect();
  }, [policy]);

  const contents = useMemo(() => policy?.sections ?? [], [policy]);

  if (error) {
    return (
      <PublicLayout>
        <div className="container-wide py-24 max-w-2xl">
          {/*
            `ErrorBlock` renders the API's message, and the policies API
            distinguishes "no such policy" from "not published to this
            environment" with its own message — so the one useful sentence
            survives without a second bespoke error panel here.
          */}
          <ErrorBlock error={error} onRetry={() => nav(0)} />
          <Link to="/policies" className="btn-ghost mt-6 inline-flex">← All policies</Link>
        </div>
      </PublicLayout>
    );
  }

  if (!policy) return <PublicLayout><PolicySkeleton /></PublicLayout>;

  return (
    <PublicLayout>
      <div className="container-wide pt-10 pb-24">
        <Link to="/policies" className="btn-ghost inline-flex items-center gap-1.5">
          <ChevLeft className="w-4 h-4" />
          All policies
        </Link>

        <header className="mt-6 max-w-3xl">
          <p className="eyebrow">
            Marqueiver Platform Policies
            {policy.number
              // "of 15" was written here as a literal; it comes from the
              // server's catalogue, so publishing another policy updates it.
              ? ` · ${String(policy.number).padStart(2, '0')}${policy.policyCount ? ` of ${policy.policyCount}` : ''}`
              : ''}
          </p>
          <h1 className="display-section mt-3">{policy.title}</h1>

          <div className="flex flex-wrap items-center gap-2 mt-5">
            <span className="pill-quiet tnum">Version {policy.version}</span>
            <span className="pill-quiet">Effective {fmtDate(policy.effectiveFrom)}</span>
            <span className="pill-quiet">
              Applies to {policy.requiredFor?.length === 2
                ? 'creators and brands'
                : `${policy.requiredFor?.[0]}s`}
            </span>
            {policy.materialChange && <span className="pill-live">Material change</span>}
          </div>

          {policy.intro?.length > 0 && (
            <div className="policy-body mt-6 text-[16px]">
              {policy.intro.map((b, i) => <Block key={i} block={b} />)}
            </div>
          )}
        </header>

        {/*
          Contents on a phone. The rail below is `hidden lg:block`, which left
          the small-screen reader — the common case, since policy links are
          followed from the signup form on a phone — with no way to reach clause
          9.3 except scrolling past clauses 1 through 9.2.
        */}
        {contents.length > 1 && (
          <button
            onClick={() => setContentsOpen(true)}
            className="lg:hidden btn-outline mt-8 w-full justify-center gap-2 inline-flex items-center"
          >
            <List className="w-4 h-4" />
            Jump to a section
            <span className="text-muted tnum">({contents.length})</span>
          </button>
        )}

        <Drawer open={contentsOpen} onClose={() => setContentsOpen(false)} title="Contents">
          <ul className="space-y-0.5">
            {contents.map((s) => {
              const id = sectionId(s);
              return (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    onClick={() => setContentsOpen(false)}
                    className={`block py-2.5 px-2 -mx-2 rounded-lg text-sm leading-snug transition-colors
                                focusable ${id === activeId
                                  ? 'bg-brand-50 text-brand-700 font-medium'
                                  : 'text-ink-soft hover:bg-bg'}`}
                  >
                    {s.number && <span className="tnum mr-2 text-muted">{s.number}</span>}
                    {s.heading}
                  </a>
                </li>
              );
            })}
          </ul>
        </Drawer>

        <div className="mt-12 grid lg:grid-cols-[220px_1fr] gap-10 xl:gap-16 items-start">
          <Contents sections={contents} activeId={activeId} />

          <article ref={bodyRef} className="min-w-0 max-w-2xl">
            {contents.map((s) => (
              <section key={sectionId(s)} className="mb-10 scroll-mt-24">
                <h2
                  id={sectionId(s)}
                  data-section
                  className="font-display font-extrabold text-lg text-ink mb-3 scroll-mt-24 group"
                >
                  {s.number && <span className="text-brand-600 tnum mr-2">{s.number}</span>}
                  {s.heading}
                  <a
                    href={`#${sectionId(s)}`}
                    className="ml-2 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100
                               transition-opacity text-sm font-normal"
                    aria-label={`Link to section ${s.number} ${s.heading}`}
                  >
                    #
                  </a>
                </h2>
                <div className="policy-body">
                  {s.blocks.map((b, i) => <Block key={i} block={b} />)}
                </div>
              </section>
            ))}

            <footer className="mt-14 pt-6 border-t border-line text-sm text-muted leading-relaxed">
              <p>
                Operated by Dahmion Technologies, New Delhi, India.
                Questions about this policy: <a href="mailto:hello@marqueiver.com"
                  className="text-brand-700 hover:underline">hello@marqueiver.com</a>.
                Grievance Officer: <a href="mailto:harsh@marqueiver.com"
                  className="text-brand-700 hover:underline">harsh@marqueiver.com</a>.
              </p>
              {policy.versions?.length > 1 && (
                <p className="mt-3">
                  Earlier versions: {policy.versions.map((v, i) => (
                    <span key={v.version}>
                      {i > 0 && ', '}
                      <Link to={`/policies/${policy.slug}?version=${v.version}`}
                        className="text-brand-700 hover:underline tnum">v{v.version}</Link>
                    </span>
                  ))}
                </p>
              )}
            </footer>
          </article>
        </div>
      </div>
    </PublicLayout>
  );
}

/* ──────────────────────────────── pieces ──────────────────────────────────── */

/**
 * One content block. The shapes come from the policy document itself, so a
 * table stays a table and a list stays a list.
 */
function Block({ block }) {
  if (block.type === 'p') return <p>{block.text}</p>;

  if (block.type === 'ul') {
    return <ul>{block.items.map((it, i) => <li key={i}>{it}</li>)}</ul>;
  }

  if (block.type === 'table') {
    return (
      // The wrapper scrolls, not the page — a wide rate table on a phone must
      // not make the whole document scroll sideways.
      <div className="overflow-x-auto -mx-1 my-5 rounded-xl2 border border-line">
        <table className="policy-table">
          <thead>
            <tr>{block.head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  j === 0
                    ? <th key={j} scope="row" className="font-medium text-ink bg-transparent border-b border-line px-3 py-2.5 text-left align-top">{cell}</th>
                    : <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return null;
}

function Contents({ sections, activeId }) {
  if (!sections.length) return <div />;
  return (
    <nav aria-label="Contents" className="hidden lg:block sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Contents</p>
      <ul className="space-y-1 border-l border-line">
        {sections.map((s) => {
          const id = sectionId(s);
          const active = id === activeId;
          return (
            <li key={id}>
              <a
                href={`#${id}`}
                aria-current={active ? 'true' : undefined}
                className={`block pl-3 -ml-px border-l-2 py-1 text-[13px] leading-snug transition-colors
                            ${active
                              ? 'border-brand-500 text-brand-700 font-medium'
                              : 'border-transparent text-muted hover:text-ink hover:border-line'}`}
              >
                {s.number && <span className="tnum mr-1.5">{s.number}</span>}
                {s.heading}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The loading state, shaped like the document.
 *
 * Every width here is a literal class. The previous version built them —
 * `{[20, 32, 28].map((w) => <div className={\`h-6 w-${w} rounded-full shimmer\`} />)}` —
 * and Tailwind's scanner only sees complete class strings in source, so
 * `w-20`, `w-32` and `w-28` were never emitted and those three pills rendered
 * at zero width.
 */
function PolicySkeleton() {
  return (
    <div
      className="container-wide pt-10 pb-24"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading policy"
    >
      <Skeleton className="h-4 w-28 rounded" />
      <Skeleton className="h-12 w-2/3 max-w-lg rounded-lg mt-6" />

      <div className="flex flex-wrap gap-2 mt-5">
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-6 w-36 rounded-full" />
        <Skeleton className="h-6 w-32 rounded-full" />
      </div>

      <div className="mt-12 grid lg:grid-cols-[220px_1fr] gap-10">
        <div className="hidden lg:block space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-full rounded" />
          ))}
        </div>
        <div className="max-w-2xl space-y-8">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-5 w-1/3 rounded" />
              <SkeletonText lines={3} className="mt-3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
