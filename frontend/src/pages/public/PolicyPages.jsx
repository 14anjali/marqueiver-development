import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { PublicLayout } from '../../components/public/PublicChrome';
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
 *  - **A contents rail** with the current section tracked as you scroll. Fourteen
 *    sections of terms is not something anyone reads top to bottom; people arrive
 *    looking for one clause.
 *  - **Deep links.** Every section has an id, so `/terms#1-3` opens the
 *    eligibility clause directly — which is what support and disputes need.
 */

const fmtDate = (d) => (d
  ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  : '');

const sectionId = (s) => `s-${String(s.number || s.heading).replace(/[^\w]+/g, '-').toLowerCase()}`;

/* ─────────────────────────────── index page ───────────────────────────────── */

export function PolicyIndexPage() {
  const [policies, setPolicies] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.listPolicies()
      .then(({ data }) => alive && setPolicies(data ?? []))
      .catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, []);

  return (
    <PublicLayout>
      <section className="container-page pt-16 pb-10 md:pt-24">
        <h1 className="h-display text-display-md md:text-display-lg max-w-3xl">Platform policies</h1>
        <p className="lede mt-5">
          These policies govern how Marqueiver works — for creators, for brands, and for the money in
          between. Each one is versioned, and we record which version you accepted and when.
        </p>
        {policies?.length > 0 && (
          <p className="mt-4 text-sm text-muted">
            {policies.length} policies · version {policies[0].version} ·
            in effect from {fmtDate(policies[0].effectiveFrom)}
          </p>
        )}
      </section>

      <section className="container-page pb-24">
        {error ? (
          <ErrorPanel error={error} onRetry={() => window.location.reload()} />
        ) : !policies ? (
          <ul className="divide-y divide-line border-y border-line" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="py-5 flex justify-between gap-4">
                <div className="h-4 w-56 rounded shimmer" />
                <div className="h-4 w-16 rounded shimmer" />
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
                  className="flex items-center gap-4 py-5 group rounded-lg px-2 -mx-2
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
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
    if (!policy || !bodyRef.current) return;
    const headings = bodyRef.current.querySelectorAll('[data-section]');
    if (!headings.length) return;

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
        <div className="container-page py-24 max-w-2xl">
          <ErrorPanel error={error} onRetry={() => nav(0)} />
          <Link to="/policies" className="auth-btn-ghost mt-6">← All policies</Link>
        </div>
      </PublicLayout>
    );
  }

  if (!policy) return <PublicLayout><PolicySkeleton /></PublicLayout>;

  return (
    <PublicLayout>
      <div className="container-page pt-10 pb-24">
        <Link to="/policies" className="auth-btn-ghost">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          All policies
        </Link>

        <header className="mt-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
            Marqueiver Platform Policies
            {policy.number ? ` · ${String(policy.number).padStart(2, '0')} of 15` : ''}
          </p>
          <h1 className="h-display text-display-md md:text-display-lg mt-2">{policy.title}</h1>

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

function PolicySkeleton() {
  return (
    <div className="container-page pt-10 pb-24" aria-busy="true" aria-label="Loading policy">
      <div className="h-4 w-28 rounded shimmer" />
      <div className="h-12 w-2/3 max-w-lg rounded shimmer mt-6" />
      <div className="flex gap-2 mt-5">
        {[20, 32, 28].map((w) => <div key={w} className={`h-6 w-${w} rounded-full shimmer`} />)}
      </div>
      <div className="mt-12 grid lg:grid-cols-[220px_1fr] gap-10">
        <div className="hidden lg:block space-y-2">
          {Array.from({ length: 10 }).map((_, i) => <div key={i} className="h-3 rounded shimmer" />)}
        </div>
        <div className="max-w-2xl space-y-8">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2.5">
              <div className="h-5 w-1/3 rounded shimmer" />
              <div className="h-3 rounded shimmer" />
              <div className="h-3 rounded shimmer" />
              <div className="h-3 w-4/5 rounded shimmer" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ErrorPanel({ error, onRetry }) {
  const notPublished = error?.detail?.code === 'POLICY_NOT_PUBLISHED';
  return (
    <div className="rounded-xl2 border border-rose-200 bg-rose-50 p-6" role="alert">
      <p className="font-medium text-rose-800">
        {notPublished ? 'This policy has not been published here yet' : 'We could not load this policy'}
      </p>
      <p className="text-sm text-rose-700 mt-1.5 leading-relaxed">
        {notPublished
          ? 'The document exists but this environment has not published it. If you are running Marqueiver locally, restart the API to publish the current policy set.'
          : error?.message}
      </p>
      {onRetry && (
        <button onClick={onRetry} className="btn-outline mt-4">Try again</button>
      )}
    </div>
  );
}
