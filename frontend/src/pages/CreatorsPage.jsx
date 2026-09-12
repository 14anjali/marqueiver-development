import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import AppShell from '../components/AppShell';
import CreatorCard from '../components/CreatorCard';
import { Drawer } from '../components/overlay';
import { SkeletonCard, AnimatedNumber } from '../components/feedback';
import { Search, ChevDown, Grid, List, Download, ChevLeft, ChevRight, Bookmark, Sliders } from '../components/icons';
import { api } from '../lib/api';
import { creatorToCard } from '../lib/normalize';
import { useAuth } from '../lib/auth';
import { ErrorBlock, EmptyBlock, Spinner, useToast } from '../lib/ui-state';
import { stagger, page as pageMotion, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';

/**
 * Creator discovery — the brand's main workspace.
 *
 * The significant fix is responsive, not decorative: the filter sidebar was
 * `hidden lg:block`, and there was no other route to it. On a phone or a tablet
 * the entire filter set — category, platform, follower floor, engagement floor,
 * location — simply did not exist, so discovery on mobile meant scrolling an
 * unfiltered list of every creator on the platform.
 *
 * The same filter panel now opens in a Drawer below `lg`, so one definition
 * serves both and they cannot drift apart.
 */

/**
 * ── The option lists come from the campaign vocabulary ─────────────────────
 *
 * Categories and languages used to be a private list in this file, and it had
 * drifted: discovery offered "Tech", "Wellness" and "Photography", while
 * creators pick their categories from the campaign vocabulary, where those
 * three do not exist. So three of the ten filters could only ever return
 * nothing, and the categories creators actually use — Parenting, Automotive,
 * Home & Living — could not be filtered for at all.
 *
 * Importing the shared lists means a brand searching for creators and a brand
 * writing a brief are choosing from the same words, which is the whole point of
 * the two routes being one product.
 */
import {
  CATEGORIES, LANGUAGES, AUDIENCE_AGE_RANGES, GENDERS, LOCATIONS,
  PLATFORMS as BRIEF_PLATFORMS,
} from '../components/campaign/vocab';

/**
 * Discovery searches `socialAccounts.platform`, which holds whatever a creator
 * connected or declared, so this stays broader than the three platforms a
 * campaign brief can target.
 */
const PLATFORMS = [...new Set([...BRIEF_PLATFORMS, 'linkedin', 'tiktok', 'x', 'pinterest'])];
/** Audience interests are described in the same words as creator categories. */
const AUDIENCE_INTERESTS = CATEGORIES;
const PAGE_SIZE = 20;

const BLANK = {
  q: '', category: '', platform: '', minFollowers: '', minEngagement: '', location: '',
  language: '', verified: '', collaborationType: '',
  audienceLocation: '', audienceAge: '', audienceGender: '', audienceInterest: '',
  sort: 'relevance',
};

/**
 * `options` accepts plain strings, or `{ value, label }` where the two differ —
 * `verified=identity` has to go to the server as that word, but "Identity
 * verified" is what a person is choosing.
 */
const Select = ({ label, value = '', options = [], onChange, placeholder = 'Any' }) => {
  const id = `f-${label.toLowerCase().replace(/\s/g, '-')}`;
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <div className="relative">
        <select id={id} value={value} onChange={(e) => onChange?.(e.target.value)} className="field appearance-none pr-8 capitalize">
          <option value="">{placeholder}</option>
          {options.map((o) => {
            const v = typeof o === 'string' ? o : o.value;
            return <option key={v} value={v}>{typeof o === 'string' ? o : o.label}</option>;
          })}
        </select>
        <ChevDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
      </div>
    </div>
  );
};

/** A labelled group, so the growing filter set stays scannable. */
const Group = ({ title, note, children }) => (
  <fieldset className="space-y-3 pt-4 first:pt-0 border-t border-line first:border-0">
    <legend className="sr-only">{title}</legend>
    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</p>
    {note && <p className="text-[11px] text-muted leading-relaxed -mt-1.5">{note}</p>}
    {children}
  </fieldset>
);

/** One definition, rendered in the sidebar on desktop and the drawer on mobile. */
function FilterFields({ filters, setF, onApply, onClear }) {
  return (
    <div className="space-y-4">
      <Group title="The creator">
        <Select label="Category" value={filters.category} options={CATEGORIES} onChange={(v) => setF('category', v)} />
        <Select label="Platform" value={filters.platform} options={PLATFORMS} onChange={(v) => setF('platform', v)} />
        <Select label="Language" value={filters.language} options={LANGUAGES} onChange={(v) => setF('language', v)} />
        <Select label="Location" value={filters.location} options={LOCATIONS} onChange={(v) => setF('location', v)} />
        <Select
          label="Collaboration type"
          value={filters.collaborationType}
          options={['paid', 'barter']}
          onChange={(v) => setF('collaborationType', v)}
        />
        <Select
          label="Verification"
          value={filters.verified}
          options={[
            { value: 'any', label: 'Verified — either' },
            { value: 'identity', label: 'Identity verified' },
            { value: 'social', label: 'Social verified' },
          ]}
          onChange={(v) => setF('verified', v)}
          placeholder="Any"
        />
      </Group>

      <Group title="Reach">
        <div>
          <label htmlFor="f-followers" className="field-label">Followers, minimum</label>
          <input
            id="f-followers" type="number" inputMode="numeric" min="0"
            value={filters.minFollowers} onChange={(e) => setF('minFollowers', e.target.value)}
            placeholder="10000" className="field tnum"
          />
        </div>
        <div>
          <label htmlFor="f-eng" className="field-label">Engagement rate, minimum %</label>
          <input
            id="f-eng" type="number" inputMode="decimal" min="0" step="0.1"
            value={filters.minEngagement} onChange={(e) => setF('minEngagement', e.target.value)}
            placeholder="2" className="field tnum"
          />
        </div>
      </Group>

      {/*
        Audience is the creator's own description of who watches them. Saying so
        here rather than in a tooltip: a brand narrowing a search on this needs
        to know it is reading a claim, not a measurement, before it filters
        ninety percent of the platform away on the strength of it.
      */}
      <Group
        title="Their audience"
        note="Declared by the creator, not measured. Creators who have not filled this in are excluded by these filters."
      >
        <Select
          label="Audience location" value={filters.audienceLocation} options={LOCATIONS}
          onChange={(v) => setF('audienceLocation', v)}
        />
        <Select
          label="Audience age" value={filters.audienceAge} options={AUDIENCE_AGE_RANGES}
          onChange={(v) => setF('audienceAge', v)}
        />
        <Select
          label="Audience gender" value={filters.audienceGender} options={GENDERS}
          onChange={(v) => setF('audienceGender', v)}
        />
        <Select
          label="Audience interest" value={filters.audienceInterest} options={AUDIENCE_INTERESTS}
          onChange={(v) => setF('audienceInterest', v)}
        />
      </Group>

      <div className="flex gap-2 pt-1">
        <button onClick={onApply} className="btn-cta flex-1">Apply</button>
        <button onClick={onClear} className="btn-ghost">Clear</button>
      </div>
    </div>
  );
}

export default function CreatorsPage() {
  const [view, setView] = useState('grid');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cards, setCards] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [savedIds, setSavedIds] = useState(new Set());
  const [exporting, setExporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(BLANK);
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const isBrand = user?.role === 'brand';
  const reduced = usePrefersReducedMotion();

  const load = useCallback(async (f = filters, p = page) => {
    setLoading(true); setError(null);
    try {
      const { data, meta } = await api.searchCreators({ ...f, page: p, limit: PAGE_SIZE });
      setCards((data || []).map(creatorToCard));
      setTotal(meta?.total ?? 0);
      setPage(p);
    } catch (e) { setError(e); } finally { setLoading(false); }
  }, [filters, page]);

  useEffect(() => { load(filters, 1); /* eslint-disable-next-line */ }, []);

  // Saved ids up front, so the heart on each card starts in the right state
  // rather than defaulting to "not saved" until clicked.
  useEffect(() => {
    if (!isBrand) return;
    api.listSavedCreators()
      .then(({ data }) => setSavedIds(new Set((data || []).map((c) => c.user))))
      .catch(() => {});
  }, [isBrand]);

  const setF = (k, v) => setFilters((s) => ({ ...s, [k]: v }));
  const applyFilters = () => { setShowFilters(false); load(filters, 1); };
  const clearFilters = () => { setFilters(BLANK); setShowFilters(false); load(BLANK, 1); };
  const openCreator = (c) => nav(`/creator/${c.id}`, { state: { creator: c.raw || c } });

  const activeCount = Object.entries(filters)
    .filter(([k, v]) => k !== 'sort' && k !== 'q' && v).length;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageNumbers = (() => {
    const nums = [];
    const start = Math.max(1, Math.min(page - 1, totalPages - 3));
    const end = Math.min(totalPages, start + 3);
    for (let i = Math.max(1, start); i <= end; i += 1) nums.push(i);
    return nums;
  })();

  async function exportCsv() {
    setExporting(true);
    try {
      await api.downloadCreatorsCsv(filters, 'marqueiver-creators.csv');
      toast.push('Export downloaded', 'success');
    } catch (e) { toast.push(e.message, 'error'); }
    finally { setExporting(false); }
  }

  const onSaveChange = (_id, next) => setSavedIds((s) => {
    const n = new Set(s);
    const key = cards.find((c) => c.id === _id)?.raw?.user ?? _id;
    if (next) n.add(key); else n.delete(key);
    return n;
  });

  return (
    <AppShell>
      <motion.div
        variants={withReducedMotion(pageMotion, reduced)}
        initial="hidden" animate="visible"
        className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 flex gap-6"
      >
        {/*
          Sticky and self-scrolling: the filter set is now long enough that a
          fixed sidebar would scroll off the top of a results page, leaving the
          brand to scroll back up to change one dropdown.
        */}
        <aside className="w-64 shrink-0 hidden lg:block space-y-4 self-start sticky top-4
                          max-h-[calc(100vh-2rem)] overflow-y-auto no-scrollbar"
        >
          <div className="card p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-bold text-ink">Filters</h2>
              {activeCount > 0 && (
                <button onClick={clearFilters} className="text-xs text-muted hover:text-brand-600 focusable px-1">
                  Clear {activeCount}
                </button>
              )}
            </div>
            <FilterFields filters={filters} setF={setF} onApply={applyFilters} onClear={clearFilters} />
          </div>

          {isBrand && (
            <Link to="/saved" className="card-interactive p-4 flex items-center gap-3">
              <span className="w-9 h-9 rounded-lg bg-pink-50 text-pink-600 grid place-items-center" aria-hidden="true">
                <Bookmark className="w-4 h-4" />
              </span>
              <div>
                <div className="text-sm font-semibold text-ink">Saved creators</div>
                <div className="text-xs text-muted tnum">{savedIds.size} shortlisted</div>
              </div>
            </Link>
          )}
        </aside>

        <main className="flex-1 min-w-0">
          <div className="flex items-center gap-2 sm:gap-3 mb-4">
            <div className="flex-1 min-w-0 relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                value={filters.q}
                onChange={(e) => setF('q', e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                placeholder="Search by name, category or keyword…"
                aria-label="Search creators"
                className="field pl-10 py-2.5"
              />
            </div>

            {/* The mobile route into the filters that did not exist. */}
            <button
              onClick={() => setShowFilters(true)}
              className="lg:hidden btn-ghost bg-white shrink-0 relative"
              aria-label={`Filters${activeCount ? `, ${activeCount} active` : ''}`}
            >
              <Sliders className="w-4 h-4" />
              {activeCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-brand-600 text-white text-[10px] grid place-items-center tnum">
                  {activeCount}
                </span>
              )}
            </button>

            <div className="relative hidden sm:block shrink-0">
              <select
                value={filters.sort}
                onChange={(e) => { setF('sort', e.target.value); load({ ...filters, sort: e.target.value }, 1); }}
                aria-label="Sort creators"
                className="field appearance-none pr-8 py-2.5"
              >
                <option value="relevance">Most relevant</option>
                <option value="followers">Most followers</option>
                <option value="engagement">Best engagement</option>
                <option value="rate">Lowest rate</option>
              </select>
              <ChevDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            </div>

            <div className="hidden sm:flex border border-line rounded-lg overflow-hidden bg-white shrink-0" role="group" aria-label="View">
              <button
                onClick={() => setView('grid')} aria-pressed={view === 'grid'} aria-label="Grid view"
                className={`p-2.5 transition-colors ${view === 'grid' ? 'bg-brand-600 text-white' : 'text-muted hover:bg-bg'}`}
              ><Grid className="w-4 h-4" /></button>
              <button
                onClick={() => setView('list')} aria-pressed={view === 'list'} aria-label="List view"
                className={`p-2.5 transition-colors ${view === 'list' ? 'bg-brand-600 text-white' : 'text-muted hover:bg-bg'}`}
              ><List className="w-4 h-4" /></button>
            </div>
          </div>

          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <p className="text-sm text-muted">
              <span className="font-display font-extrabold text-ink tnum">
                <AnimatedNumber value={total} />
              </span>{' '}
              {total === 1 ? 'creator' : 'creators'} found
            </p>
            {isBrand && cards.length > 0 && (
              <button onClick={exportCsv} disabled={exporting} className="btn-ghost bg-white text-sm">
                {exporting ? <Spinner className="w-4 h-4" /> : <><Download className="w-4 h-4" /> Export</>}
              </button>
            )}
          </div>

          {loading ? (
            <div
              className={view === 'grid'
                ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4'
                : 'grid grid-cols-1 gap-4'}
              role="status" aria-live="polite"
            >
              <span className="sr-only">Finding creators…</span>
              {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : error ? (
            <ErrorBlock error={error} onRetry={() => load()} />
          ) : !cards.length ? (
            <EmptyBlock
              title="No creators match those filters"
              sub="Try widening the follower or engagement floor, or clearing a category."
              action={activeCount > 0 && <button onClick={clearFilters} className="btn-outline mt-1">Clear filters</button>}
            />
          ) : (
            <motion.div
              variants={withReducedMotion(stagger, reduced)}
              initial="hidden" animate="visible"
              className={view === 'grid'
                ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4'
                : 'grid grid-cols-1 gap-4'}
            >
              {cards.map((c) => (
                <CreatorCard
                  key={c.id}
                  c={c}
                  onOpen={openCreator}
                  saved={savedIds.has(c.raw?.user)}
                  onSaveChange={onSaveChange}
                />
              ))}
            </motion.div>
          )}

          {!loading && !error && totalPages > 1 && (
            <nav className="flex items-center justify-center gap-1 mt-8" aria-label="Pagination">
              <button
                onClick={() => load(filters, Math.max(1, page - 1))} disabled={page <= 1}
                aria-label="Previous page"
                className="w-9 h-9 rounded-lg border border-line grid place-items-center text-muted hover:bg-white disabled:opacity-40 transition-colors focusable"
              ><ChevLeft className="w-4 h-4" /></button>
              {pageNumbers.map((n) => (
                <button
                  key={n} onClick={() => load(filters, n)}
                  aria-current={n === page ? 'page' : undefined}
                  className={`w-9 h-9 rounded-lg text-sm font-medium grid place-items-center transition-colors tnum focusable ${
                    n === page ? 'bg-brand-600 text-white' : 'text-muted hover:bg-white border border-transparent'}`}
                >{n}</button>
              ))}
              <button
                onClick={() => load(filters, Math.min(totalPages, page + 1))} disabled={page >= totalPages}
                aria-label="Next page"
                className="w-9 h-9 rounded-lg border border-line grid place-items-center text-muted hover:bg-white disabled:opacity-40 transition-colors focusable"
              ><ChevRight className="w-4 h-4" /></button>
            </nav>
          )}
        </main>
      </motion.div>

      <Drawer open={showFilters} onClose={() => setShowFilters(false)} title="Filters">
        <FilterFields filters={filters} setF={setF} onApply={applyFilters} onClear={clearFilters} />
        <div className="mt-6 pt-5 border-t border-line">
          <label htmlFor="f-sort-m" className="field-label">Sort by</label>
          <div className="relative">
            <select
              id="f-sort-m" value={filters.sort}
              onChange={(e) => setF('sort', e.target.value)}
              className="field appearance-none pr-8"
            >
              <option value="relevance">Most relevant</option>
              <option value="followers">Most followers</option>
              <option value="engagement">Best engagement</option>
              <option value="rate">Lowest rate</option>
            </select>
            <ChevDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          </div>
        </div>
      </Drawer>
    </AppShell>
  );
}