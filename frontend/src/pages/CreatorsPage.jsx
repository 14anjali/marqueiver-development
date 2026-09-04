import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import CreatorCard from '../components/CreatorCard';
import { Search, ChevDown, Grid, List, Download, ChevLeft, ChevRight, Bookmark } from '../components/icons';
import { api } from '../lib/api';
import { creatorToCard } from '../lib/normalize';
import { useAuth } from '../lib/auth';
import { LoadingBlock, ErrorBlock, EmptyBlock, Spinner, useToast } from '../lib/ui-state';

const Select = ({ label, value = 'All', options = [], onChange }) => (
  <div>
    <label className="block text-[13px] font-medium text-ink mb-1.5">{label}</label>
    <div className="relative">
      <select value={value} onChange={(e) => onChange?.(e.target.value)}
        className="w-full appearance-none border border-line rounded-lg px-3 py-2 text-sm text-ink bg-white hover:border-brand-300 focus:outline-none focus:border-brand-400 pr-8">
        <option value="">{label === 'Categories' ? 'Select categories' : label === 'Location' ? 'Select location' : 'All'}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
    </div>
  </div>
);

const CATEGORIES = ['Fitness', 'Lifestyle', 'Fashion', 'Beauty', 'Tech', 'Travel', 'Finance', 'Wellness', 'Food', 'Photography'];
const PLATFORMS = ['instagram', 'youtube', 'linkedin', 'tiktok', 'x', 'facebook', 'pinterest'];
const PAGE_SIZE = 20;

export default function CreatorsPage() {
  const [view, setView] = useState('grid');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cards, setCards] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [savedIds, setSavedIds] = useState(new Set());
  const [exporting, setExporting] = useState(false);
  const [filters, setFilters] = useState({ q: '', category: '', platform: '', minFollowers: '', minEngagement: '', location: '', sort: 'relevance' });
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const isBrand = user?.role === 'brand';

  const load = useCallback(async (f = filters, p = page) => {
    setLoading(true); setError(null);
    try {
      const { data, meta } = await api.searchCreators({ ...f, page: p, limit: PAGE_SIZE });
      setCards((data || []).map(creatorToCard));
      setTotal(meta?.total ?? 0);
      setPage(p);
    } catch (e) {
      setError(e);
    } finally { setLoading(false); }
  }, [filters, page]);

  useEffect(() => { load(filters, 1); /* eslint-disable-next-line */ }, []);

  // Load the brand's saved-creator ids once, so heart state is correct on render
  // (rather than every card defaulting to "not saved" until clicked).
  useEffect(() => {
    if (!isBrand) return;
    api.listSavedCreators().then(({ data }) => setSavedIds(new Set((data || []).map((c) => c.user)))).catch(() => {});
  }, [isBrand]);

  const applyFilters = () => load(filters, 1);
  const setF = (k, v) => setFilters((s) => ({ ...s, [k]: v }));
  const openCreator = (c) => nav(`/creator/${c.id}`, { state: { creator: c.raw || c } });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageNumbers = (() => {
    const nums = [];
    const start = Math.max(1, page - 1);
    const end = Math.min(totalPages, start + 3);
    for (let i = start; i <= end; i++) nums.push(i);
    return nums;
  })();

  async function exportCsv() {
    setExporting(true);
    try { await api.downloadCreatorsCsv(filters, 'marqueiver-creators.csv'); toast.push('Export downloaded ✓', 'success'); }
    catch (e) { toast.push(e.message, 'error'); } finally { setExporting(false); }
  }

  return (
    <AppShell>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 flex gap-6">
        {/* filter sidebar */}
        <aside className="w-64 shrink-0 hidden lg:block space-y-5">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-bold text-ink border-l-[3px] border-brand-600 pl-2">Filters</h2>
              <button onClick={() => { const f = { q: '', category: '', platform: '', minFollowers: '', minEngagement: '', location: '', sort: 'relevance' }; setFilters(f); load(f, 1); }} className="text-xs text-muted hover:text-brand-600">Clear All</button>
            </div>
            <div className="space-y-4">
              <Select label="Categories" value={filters.category} options={CATEGORIES} onChange={(v) => setF('category', v)} />
              <Select label="Platform" value={filters.platform} options={PLATFORMS} onChange={(v) => setF('platform', v)} />
              <div>
                <label className="block text-[13px] font-medium text-ink mb-2">Followers (min)</label>
                <input type="number" value={filters.minFollowers} onChange={(e) => setF('minFollowers', e.target.value)} placeholder="10000"
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-ink mb-2">Engagement Rate (min %)</label>
                <input type="number" value={filters.minEngagement} onChange={(e) => setF('minEngagement', e.target.value)} placeholder="2"
                  className="w-full border border-line rounded-lg px-3 py-2 text-sm" />
              </div>
              <Select label="Location" value={filters.location} options={['India', 'United States', 'UAE', 'United Kingdom']} onChange={(v) => setF('location', v)} />
              <button onClick={applyFilters} className="btn-cta w-full">Apply Filters</button>
            </div>
          </div>

          {isBrand && (
            <Link to="/saved" className="card p-4 flex items-center gap-3 hover:bg-bg transition">
              <span className="w-9 h-9 rounded-lg bg-pink-50 text-pink-600 flex items-center justify-center"><Bookmark className="w-4 h-4" /></span>
              <div>
                <div className="text-sm font-semibold text-ink">Saved Creators</div>
                <div className="text-xs text-muted">{savedIds.size} saved</div>
              </div>
            </Link>
          )}
        </aside>

        {/* main */}
        <main className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="flex-1 min-w-[200px] relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input value={filters.q} onChange={(e) => setF('q', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                placeholder="Search creators by name, category, keyword..."
                className="w-full bg-white border border-line rounded-lg pl-10 pr-10 py-2.5 text-sm focus:outline-none focus:border-brand-400" />
            </div>
            <div className="relative hidden sm:block">
              <select value={filters.sort} onChange={(e) => { setF('sort', e.target.value); load({ ...filters, sort: e.target.value }, 1); }}
                className="appearance-none btn-ghost bg-white pr-8">
                <option value="relevance">Sort by: Relevance</option>
                <option value="followers">Most Followers</option>
                <option value="engagement">Best Engagement</option>
                <option value="rate">Lowest Rate</option>
              </select>
              <ChevDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            </div>
            <div className="hidden sm:flex border border-line rounded-lg overflow-hidden bg-white">
              <button onClick={() => setView('grid')} className={`p-2.5 ${view === 'grid' ? 'bg-brand-600 text-white' : 'text-muted'}`}><Grid className="w-4 h-4" /></button>
              <button onClick={() => setView('list')} className={`p-2.5 ${view === 'list' ? 'bg-brand-600 text-white' : 'text-muted'}`}><List className="w-4 h-4" /></button>
            </div>
          </div>

          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <p className="text-sm"><span className="font-display font-extrabold text-pink-500">{total.toLocaleString('en-IN')}</span> <span className="text-muted">Creators found</span></p>
          </div>

          {loading ? <LoadingBlock label="Finding creators…" />
            : error ? <ErrorBlock error={error} onRetry={() => load()} />
            : cards.length === 0 ? <EmptyBlock title="No creators match those filters" sub="Try clearing a filter or widening your search." />
            : (
              <div className={view === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4' : 'grid grid-cols-1 gap-4'}>
                {cards.map((c) => (
                  <CreatorCard key={c.id} c={c} onOpen={openCreator} saved={savedIds.has(c.raw?.user)}
                    onSaveChange={(id, next) => setSavedIds((s) => { const n = new Set(s); id && (next ? n.add(c.raw?.user) : n.delete(c.raw?.user)); return n; })} />
                ))}
              </div>
            )}

          {!loading && !error && totalPages > 1 && (
            <div className="flex items-center justify-between mt-8">
              <div className="w-40" />
              <div className="flex items-center gap-1">
                <button onClick={() => load(filters, Math.max(1, page - 1))} disabled={page <= 1}
                  className="w-9 h-9 rounded-lg border border-line flex items-center justify-center text-muted hover:bg-white disabled:opacity-40"><ChevLeft className="w-4 h-4" /></button>
                {pageNumbers.map((n) => (
                  <button key={n} onClick={() => load(filters, n)}
                    className={`w-9 h-9 rounded-lg text-sm font-medium flex items-center justify-center ${n === page ? 'bg-brand-600 text-white' : 'text-muted hover:bg-white border border-transparent'}`}>{n}</button>
                ))}
                <button onClick={() => load(filters, Math.min(totalPages, page + 1))} disabled={page >= totalPages}
                  className="w-9 h-9 rounded-lg border border-line flex items-center justify-center text-muted hover:bg-white disabled:opacity-40"><ChevRight className="w-4 h-4" /></button>
              </div>
              <button onClick={exportCsv} disabled={exporting} className="btn-ghost bg-white">{exporting ? <Spinner className="w-4 h-4" /> : <><Download className="w-4 h-4" /> Export Creators</>}</button>
            </div>
          )}
        </main>
      </div>
    </AppShell>
  );
}
