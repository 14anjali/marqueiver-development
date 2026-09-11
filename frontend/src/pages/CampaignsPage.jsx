import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import AppPage, { FilterRail } from '../components/AppPage';
import { Modal } from '../components/overlay';
import { StatusPill, Money, SkeletonList } from '../components/feedback';
import { MapPin, Send, X, Check, Users } from '../components/icons';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { rupee } from '../lib/normalize';
import { ErrorBlock, EmptyBlock, Spinner, useToast } from '../lib/ui-state';
import { rise, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';

/**
 * Campaigns — a brand's own, or the open ones a creator can apply to.
 *
 * A crash and two gaps were fixed here:
 *
 *  1. **`<Link>` was used without being imported.** The "Open negotiation"
 *     button on an accepted application threw `Link is not defined` and took
 *     the page down — reachable by exactly the creators who had just been
 *     accepted, which is the worst possible audience for it.
 *
 *  2. **No way to submit a campaign for review.** Campaigns now start as
 *     `pending_review` and a rejected one has to be resubmitted, and neither
 *     action existed in the UI, so a rejected campaign was a dead end.
 *
 *  3. **The status pill knew two states.** It coloured `open` green and
 *     everything else grey, so `pending_review` and `rejected` — the two a
 *     brand most needs to tell apart — looked identical.
 */

const APPLICATION_LABEL = {
  pending: 'Applied — awaiting review',
  accepted: 'Accepted',
  rejected: 'Not selected',
};

/**
 * Creating a campaign is no longer a modal.
 *
 * It was five fields — title, brief, budget, location, tags — which is not a
 * brief: no deliverables, no timeline, no usage rights, so every campaign
 * reached review missing the things a creator needs in order to apply. The
 * eight-section wizard at `/campaigns/new` replaced it, and this page now links
 * there. `CreateCampaignModal` was deleted rather than left unused.
 */

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
  const reduced = usePrefersReducedMotion();

  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [applicantsFor, setApplicantsFor] = useState(null);
  const [applyingId, setApplyingId] = useState(null);
  const [submittingId, setSubmittingId] = useState(null);
  const [filter, setFilter] = useState('all');

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.listCampaigns(); setCampaigns(data || []); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

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
      if (/already applied/i.test(e.message)) load();
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
    } catch (e) { toast.push(e.message, 'error'); }
    finally { setSubmittingId(null); }
  }

  // Brands filter their own campaigns by state; creators only ever see open ones.
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

  const shown = filter === 'all' ? campaigns : campaigns.filter((c) => c.status === filter);

  return (
    <AppPage
      title={isBrand ? 'My campaigns' : 'Browse campaigns'}
      description={isBrand
        ? 'Marqueiver reviews each campaign before creators can see it.'
        : 'Open campaigns you can apply to right now.'}
      loading={loading}
      error={error}
      onRetry={load}
      isEmpty={!shown.length}
      emptyTitle={isBrand
        ? (filter === 'all' ? 'No campaigns yet' : 'Nothing in this state')
        : 'No open campaigns right now'}
      emptySub={isBrand
        ? (filter === 'all'
          ? 'Create your first campaign and it goes into review — usually decided within a day.'
          : 'Clear the filter to see your other campaigns.')
        : 'New campaigns open regularly. Saved creators and your profile stay ready in the meantime.'}
      emptyAction={isBrand && filter === 'all'
        ? <Link to="/campaigns/new" className="btn-cta mt-2">Create a campaign</Link>
        : isBrand ? <button onClick={() => setFilter('all')} className="btn-outline mt-1">Show all</button> : null}
      actions={isBrand && (
        <Link to="/campaigns/new" className="btn-cta">
          Create campaign <Send className="w-4 h-4" />
        </Link>
      )}
      toolbar={isBrand && campaigns.length > 1 && filters && (
        <FilterRail options={filters} value={filter} onChange={setFilter} label="Filter campaigns" />
      )}
      skeletonRows={3}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {shown.map((c) => {
          const needsResubmit = c.status === 'rejected' || c.status === 'draft';
          return (
            <motion.article
              key={c._id}
              variants={withReducedMotion(rise, reduced)}
              className={`card overflow-hidden flex flex-col ${c.status === 'rejected' ? 'border-rose-200' : ''}`}
            >
              <div className="p-4 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h2 className="font-semibold text-ink leading-snug">{c.title}</h2>
                  {isBrand && <StatusPill status={c.status} />}
                </div>

                {c.brief && (
                  <p className="text-xs text-muted mt-1 leading-relaxed line-clamp-2">{c.brief}</p>
                )}

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
                  {!isBrand && c.deadline && (
                    <span className="text-xs text-muted tnum">
                      by {new Date(c.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                </div>

                {/* The reviewer's reason, where the brand can act on it. */}
                {isBrand && c.status === 'rejected' && c.review?.reason && (
                  <p className="text-xs text-rose-700 bg-rose-50 rounded-lg p-2.5 mt-3 leading-relaxed">
                    {c.review.reason}
                  </p>
                )}

                {isBrand ? (
                  <div className="mt-3 space-y-2">
                    {needsResubmit && (
                      <>
                        <Link to={`/campaigns/${c._id}/edit`} className="btn-outline w-full text-sm">
                          Continue editing
                        </Link>
                        <button
                          onClick={() => submitForReview(c._id)}
                          disabled={submittingId === c._id}
                          className="btn-cta w-full text-sm"
                        >
                          {submittingId === c._id
                            ? <Spinner className="w-4 h-4" />
                            : c.status === 'rejected' ? 'Resubmit for review' : 'Submit for review'}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setApplicantsFor(c)}
                      disabled={c.status !== 'open' && !(c.applicants?.length)}
                      className="btn-outline w-full text-sm disabled:opacity-40"
                    >
                      Applicants ({c.applicants?.length ?? 0})
                    </button>
                  </div>
                ) : c.myApplication ? (
                  <div className="mt-3">
                    <div className={`w-full text-center text-sm font-semibold rounded-lg py-2.5 ${
                      c.myApplication.status === 'accepted' ? 'bg-jade-50 text-jade-700'
                        : c.myApplication.status === 'rejected' ? 'bg-bg text-muted'
                          : 'bg-brand-50 text-brand-700'}`}
                    >
                      {APPLICATION_LABEL[c.myApplication.status] ?? 'Applied'}
                    </div>
                    {c.myApplication.status === 'accepted' && c.myApplication.deal && (
                      <Link to={`/deals/${c.myApplication.deal}`} className="btn-outline w-full mt-2 text-sm">
                        Open negotiation
                      </Link>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => apply(c._id)}
                    disabled={applyingId === c._id || c.status !== 'open'}
                    className="btn-brand w-full mt-3 disabled:opacity-50"
                  >
                    {applyingId === c._id ? <Spinner className="w-4 h-4" /> : 'Apply now'}
                  </button>
                )}
              </div>
            </motion.article>
          );
        })}
      </div>

      {applicantsFor && (
        <ApplicantsModal campaign={applicantsFor} onClose={() => setApplicantsFor(null)} />
      )}
    </AppPage>
  );
}