import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import AppPage, { FilterRail } from '../components/AppPage';
import { Modal } from '../components/overlay';
import { StatusPill, Money, SkeletonList } from '../components/feedback';
import CampaignCard from '../components/campaign/CampaignCard';
import { SelectField } from '../components/campaign/wizard';
import { CATEGORIES, PLATFORMS, PLATFORM_LABEL } from '../components/campaign/vocab';
import { MapPin, Send, X, Check, Users, Search } from '../components/icons';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { ErrorBlock, EmptyBlock, Spinner, useToast } from '../lib/ui-state';
import { rise, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';

/**
 * Campaigns — a brand's own, or the open ones a creator can apply to.
 *
 * The two sides share a page because they are the same collection seen from two
 * ends, but almost nothing else: a brand is managing drafts and review states,
 * a creator is shopping. So the toolbar, the card and the empty state all
 * branch on role rather than trying to be one thing.
 *
 * ── Creator discovery ──────────────────────────────────────────────────────
 *
 * Search and filters go to the server as query parameters on the existing
 * `GET /api/campaigns`, which is also where the rule that keeps unapproved
 * campaigns invisible lives. Filtering client-side would have meant fetching
 * everything and then hiding it, which is both slower and one refactor away
 * from leaking something that was only ever hidden in the browser.
 *
 * ── Creating a campaign is no longer a modal ───────────────────────────────
 *
 * It was five fields — title, brief, budget, location, tags — which is not a
 * brief: no deliverables, no timeline, no usage rights, so every campaign
 * reached review missing the things a creator needs in order to apply. The
 * eight-section wizard at `/campaigns/new` replaced it, and this page links
 * there.
 */

/** How long to wait after the last keystroke before searching. */
const SEARCH_DEBOUNCE_MS = 350;

const BLANK_FILTERS = { q: '', category: '', platform: '', minBudget: '' };

function ApplicantsModal({ campaign, onClose }) {
  const [applicants, setApplicants] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const toast = useToast();

  useEffect(() => {
    api.listCampaignApplicants(campaign._id).then(({ data }) => setApplicants(data)).catch(setError);
  }, [campaign._id]);

  async function decide(creatorId, status) {
    setBusyId(creatorId);
    try {
      await api.decideApplicant(campaign._id, creatorId, status);
      setApplicants((list) => list.map((a) => (a.creator === creatorId ? { ...a, status } : a)));
      toast.push(status === 'accepted' ? 'Creator selected' : 'Application declined', 'success');
    } catch (e) { toast.push(e.message, 'error'); }
    finally { setBusyId(null); }
  }

  return (
    <Modal
      open onClose={onClose} size="lg"
      title={`Applicants — ${campaign.title}`}
      description="Accepting opens a negotiation. You can accept more than one."
    >
      {error ? <ErrorBlock error={error} />
        : !applicants ? <SkeletonList count={3} label="Loading applicants…" />
          : !applicants.length ? (
            <EmptyBlock
              title="No applicants yet"
              sub="Creators who apply appear here. Campaigns usually see their first applications within a day of going live."
              icon={<Users className="w-6 h-6" />}
            />
          ) : (
            <div className="divide-y divide-line">
              {applicants.map((a) => (
                <div key={a.creator} className="flex items-center gap-3 py-3 flex-wrap sm:flex-nowrap">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-ink truncate">
                      {a.profile?.displayName || 'Creator'}
                    </div>
                    <div className="text-xs text-muted truncate">
                      {a.profile?.headline}
                      {a.profile?.totalAudience ? ` · ${a.profile.totalAudience.toLocaleString('en-IN')} audience` : ''}
                    </div>
                  </div>
                  {a.status === 'pending' ? (
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => decide(a.creator, 'accepted')}
                        disabled={busyId === a.creator}
                        className="btn-brand text-xs py-1.5 px-3"
                      >
                        {busyId === a.creator ? <Spinner className="w-3.5 h-3.5" /> : <><Check className="w-3.5 h-3.5" /> Select</>}
                      </button>
                      <button
                        onClick={() => decide(a.creator, 'rejected')}
                        disabled={busyId === a.creator}
                        className="btn-ghost text-xs py-1.5 px-3 text-rose-500"
                      >
                        <X className="w-3.5 h-3.5" /> Decline
                      </button>
                    </div>
                  ) : (
                    <StatusPill status={a.status === 'accepted' ? 'completed' : 'declined'} />
                  )}
                </div>
              ))}
            </div>
          )}
    </Modal>
  );
}

export default function CampaignsPage() {
  const { user } = useAuth();
  const isBrand = user?.role === 'brand';
  const toast = useToast();

  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [applicantsFor, setApplicantsFor] = useState(null);
  const [applyingId, setApplyingId] = useState(null);
  const [submittingId, setSubmittingId] = useState(null);
  const [filter, setFilter] = useState('all');

  /* Creator-side search and filters, sent to the server. */
  const [search, setSearch] = useState(BLANK_FILTERS);
  const [applied, setApplied] = useState(BLANK_FILTERS);
  const debounce = useRef(null);

  const load = useCallback(async (params = {}) => {
    setLoading(true); setError(null);
    try {
      const { data } = await api.listCampaigns(undefined, params);
      setCampaigns(data || []);
    } catch (e) { setError(e); } finally { setLoading(false); }
  }, []);

  /**
   * One loader for both roles, so mounting does not fire two requests.
   *
   * The query goes to the server after a pause, the dropdowns go immediately:
   * typing "beauty" should not be six requests, while choosing a platform is a
   * deliberate act and waiting a third of a second for it feels broken.
   */
  useEffect(() => {
    if (isBrand) { load(); return undefined; }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setApplied(search);
      load(cleanParams(search));
    }, search.q === applied.q ? 0 : SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(debounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, isBrand]);

  /**
   * Application state comes from the server (`myApplication` on each campaign),
   * never from local state — that was the original bug: a refresh wiped the Set
   * and the Apply button came back even though the application existed.
   */
  async function apply(campaignId) {
    setApplyingId(campaignId);
    try {
      const { data } = await api.applyToCampaign(campaignId);
      setCampaigns((list) => list.map((c) =>
        (c._id === campaignId ? { ...c, myApplication: data.application } : c)));
      toast.push('Application sent', 'success');
    } catch (e) {
      if (/already applied/i.test(e.message)) load(cleanParams(applied));
      toast.push(e.message, 'error');
    } finally { setApplyingId(null); }
  }

  /** Put a draft or rejected campaign back into the review queue. */
  async function submitForReview(campaignId) {
    setSubmittingId(campaignId);
    try {
      const { data } = await api.submitCampaignForReview(campaignId);
      setCampaigns((list) => list.map((c) => (c._id === campaignId ? data : c)));
      toast.push('Sent for review', 'success');
    } catch (e) {
      // The publish gate answers with the checklist; send the brand to the
      // wizard's review step rather than making them hunt for what is missing.
      const blocking = e?.detail?.details?.blocking;
      toast.push(blocking?.length ? blocking[0] : e.message, 'error');
    } finally { setSubmittingId(null); }
  }

  // Brands filter their own campaigns by state; creators filter the catalogue.
  const filters = useMemo(() => {
    if (!isBrand) return null;
    const counts = campaigns.reduce((acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1; return acc;
    }, {});
    const order = ['draft', 'pending_review', 'open', 'rejected', 'closed'];
    const label = {
      draft: 'Drafts', pending_review: 'In review', open: 'Live',
      rejected: 'Needs changes', closed: 'Closed',
    };
    return [
      { id: 'all', label: 'All', count: campaigns.length },
      ...order.filter((s) => counts[s]).map((s) => ({ id: s, label: label[s], count: counts[s] })),
    ];
  }, [campaigns, isBrand]);

  const shown = !isBrand || filter === 'all'
    ? campaigns
    : campaigns.filter((c) => c.status === filter);

  const searching = !isBrand && Object.values(applied).some(Boolean);

  return (
    <AppPage
      title={isBrand ? 'My campaigns' : 'Browse campaigns'}
      description={isBrand
        ? 'Marqueiver reviews each campaign before creators can see it.'
        : 'Open campaigns you can apply to right now.'}
      loading={loading}
      error={error}
      onRetry={() => load(cleanParams(applied))}
      isEmpty={!shown.length}
      emptyTitle={isBrand
        ? (filter === 'all' ? 'No campaigns yet' : 'Nothing in this state')
        : searching ? 'Nothing matches those filters' : 'No open campaigns right now'}
      emptySub={isBrand
        ? (filter === 'all'
          ? 'Create your first campaign and it goes into review — usually decided within a day.'
          : 'Clear the filter to see your other campaigns.')
        : searching
          ? 'Try a broader search, or clear the filters to see everything that is open.'
          : 'New campaigns open regularly. Your profile and connected accounts stay ready in the meantime.'}
      emptyAction={isBrand
        ? (filter === 'all'
          ? <Link to="/campaigns/new" className="btn-cta mt-2">Create a campaign</Link>
          : <button onClick={() => setFilter('all')} className="btn-outline mt-1">Show all</button>)
        : searching
          ? <button onClick={() => setSearch(BLANK_FILTERS)} className="btn-outline mt-1">Clear filters</button>
          : null}
      actions={isBrand && (
        <Link to="/campaigns/new" className="btn-cta">
          Create campaign <Send className="w-4 h-4" />
        </Link>
      )}
      toolbar={isBrand
        ? (campaigns.length > 1 && filters && (
          <FilterRail options={filters} value={filter} onChange={setFilter} label="Filter campaigns" />
        ))
        : (
          <CampaignSearch
            value={search}
            onChange={setSearch}
            onClear={() => setSearch(BLANK_FILTERS)}
            active={searching}
          />
        )}
      skeletonRows={3}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {shown.map((c) => (isBrand ? (
          <BrandCampaignCard
            key={c._id}
            campaign={c}
            busy={submittingId === c._id}
            onSubmit={() => submitForReview(c._id)}
            onApplicants={() => setApplicantsFor(c)}
          />
        ) : (
          <CampaignCard
            key={c._id}
            campaign={c}
            onApply={apply}
            applying={applyingId === c._id}
          />
        )))}
      </div>

      {applicantsFor && (
        <ApplicantsModal campaign={applicantsFor} onClose={() => setApplicantsFor(null)} />
      )}
    </AppPage>
  );
}

/** Only the parameters that are set — an empty string is not a filter. */
function cleanParams(f) {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v != null));
}

/** Search box plus two dropdowns, on the page's existing toolbar slot. */
function CampaignSearch({ value, onChange, onClear, active }) {
  const set = (k, v) => onChange({ ...value, [k]: v });

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="search"
          value={value.q}
          onChange={(e) => set('q', e.target.value)}
          placeholder="Search campaigns by name, brief or tag"
          aria-label="Search campaigns"
          className="w-full rounded-xl2 border border-line bg-white pl-10 pr-3.5 py-2.5 text-sm
                     transition-colors focus:border-brand-400 focusable"
        />
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <SelectField
          id="cf-category"
          label="Category"
          value={value.category}
          onChange={(v) => set('category', v)}
          options={CATEGORIES}
          placeholder="Any category"
        />
        <SelectField
          id="cf-platform"
          label="Platform"
          value={value.platform}
          onChange={(v) => set('platform', v)}
          options={PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABEL[p] }))}
          placeholder="Any platform"
        />
        <SelectField
          id="cf-budget"
          label="Minimum fee"
          value={value.minBudget}
          onChange={(v) => set('minBudget', v)}
          options={[
            { value: '5000', label: '₹5,000+' },
            { value: '15000', label: '₹15,000+' },
            { value: '30000', label: '₹30,000+' },
            { value: '75000', label: '₹75,000+' },
          ]}
          placeholder="Any fee"
        />
      </div>

      {active && (
        <button onClick={onClear} className="text-xs font-semibold text-brand-700 focusable">
          Clear filters
        </button>
      )}
    </div>
  );
}

/**
 * The brand's own campaign, which is a management row rather than a listing.
 *
 * Deliberately a different card from the creator's: what a brand needs here is
 * the state, the reviewer's reason when there is one, and the next action —
 * none of which a creator ever sees.
 */
function BrandCampaignCard({ campaign: c, busy, onSubmit, onApplicants }) {
  const reduced = usePrefersReducedMotion();
  const needsResubmit = c.status === 'rejected' || c.status === 'draft';

  return (
    <motion.article
      variants={withReducedMotion(rise, reduced)}
      className={`card overflow-hidden flex flex-col ${c.status === 'rejected' ? 'border-rose-200' : ''}`}
    >
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h2 className="font-semibold text-ink leading-snug">
            <Link to={`/campaigns/${c._id}`} className="hover:text-brand-700 transition-colors focusable">
              {c.title}
            </Link>
          </h2>
          <StatusPill status={c.status} />
        </div>

        {c.brief && <p className="text-xs text-muted mt-1 leading-relaxed line-clamp-2">{c.brief}</p>}

        {c.tags?.length > 0 && (
          <div className="flex gap-1.5 my-2.5 flex-wrap">
            {c.tags.slice(0, 4).map((t) => <span key={t} className="chip">{t}</span>)}
          </div>
        )}

        <div className="text-xs text-muted inline-flex items-center gap-1 mt-auto pt-2">
          <MapPin className="w-3 h-3" />{c.location}
        </div>

        <div className="flex items-center justify-between mt-2">
          <Money amount={c.budget} />
          {c.deliverables?.length > 0 && (
            <span className="text-xs text-muted">
              {c.deliverables.reduce((n, d) => n + (Number(d.quantity) || 0), 0)} deliverables
            </span>
          )}
        </div>

        {/* The reviewer's reason, where the brand can act on it. */}
        {c.status === 'rejected' && c.review?.reason && (
          <p className="text-xs text-rose-700 bg-rose-50 rounded-lg p-2.5 mt-3 leading-relaxed">
            {c.review.reason}
          </p>
        )}

        <div className="mt-3 space-y-2">
          {needsResubmit && (
            <>
              <Link to={`/campaigns/${c._id}/edit`} className="btn-outline w-full text-sm">
                Continue editing
              </Link>
              <button onClick={onSubmit} disabled={busy} className="btn-cta w-full text-sm">
                {busy
                  ? <Spinner className="w-4 h-4" />
                  : c.status === 'rejected' ? 'Resubmit for review' : 'Submit for review'}
              </button>
            </>
          )}
          <button
            onClick={onApplicants}
            disabled={c.status !== 'open' && !(c.applicants?.length)}
            className="btn-outline w-full text-sm disabled:opacity-40"
          >
            Applicants ({c.applicants?.length ?? 0})
          </button>
        </div>
      </div>
    </motion.article>
  );
}