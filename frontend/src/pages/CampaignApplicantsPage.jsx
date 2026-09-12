import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import AppPage, { FilterRail } from '../components/AppPage';
import ApplicantCard from '../components/campaign/ApplicantCard';
import { SelectField } from '../components/campaign/wizard';
import { StatusPill } from '../components/feedback';
import { Users, ChevDown } from '../components/icons';
import { api } from '../lib/api';
import { useToast } from '../lib/ui-state';
import { brandStatusMeta } from '../components/campaign/applicationStatus';

/**
 * The brand's review queue for one campaign.
 *
 * ── Why this is a page and not the modal it replaces ───────────────────────
 *
 * Reviewing an application means reading a pitch, looking at four pieces of
 * work and comparing a proposed price against a fee — none of which fits in a
 * dialog, and all of which a brand wants to be able to link to, come back to,
 * and read on a phone. The modal showed a name, a headline and two buttons,
 * which is enough to accept someone you have not actually reviewed.
 *
 * ── Filtering and sorting go to the server ─────────────────────────────────
 *
 * Both are query parameters on the existing applicants endpoint, and the
 * counts come back as `meta.counts` so the tabs stay honest while a filter is
 * on — a "Shortlisted 3" tab computed from a filtered list would read 3 of 3.
 *
 * ── What a decision does ───────────────────────────────────────────────────
 *
 * Shortlisting and un-shortlisting move the application between review states
 * and nothing else: no collaboration starts, no deal moves. Selecting is the
 * acceptance that opens the collaboration; rejecting closes it. That asymmetry
 * lives on the server — this page just shows which is which.
 */

const SORTS = [
  { value: 'recent', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'followers', label: 'Most followers' },
  { value: 'engagement', label: 'Best engagement' },
  { value: 'price', label: 'Lowest price' },
];

/** The order a reviewer works in, not the order the model declares. */
const TAB_ORDER = ['applied', 'under_review', 'shortlisted', 'selected', 'rejected', 'withdrawn'];

export default function CampaignApplicantsPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const toast = useToast();

  const [applicants, setApplicants] = useState(null);
  const [counts, setCounts] = useState({});
  const [campaign, setCampaign] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const status = params.get('status') ?? 'all';
  const sort = params.get('sort') ?? 'recent';

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data, meta } = await api.listCampaignApplicants(id, {
        status: status === 'all' ? '' : status,
        sort,
      });
      setApplicants(data ?? []);
      setCounts(meta?.counts ?? {});
    } catch (e) {
      setError(e);
    }
  }, [id, status, sort]);

  // The campaign itself is loaded once: the card needs its fee to say whether a
  // proposed price is above it, and its questions to label the answers.
  useEffect(() => {
    let alive = true;
    api.getCampaign(id)
      .then(({ data }) => { if (alive) setCampaign(data); })
      .catch(() => { if (alive) setCampaign(null); });
    return () => { alive = false; };
  }, [id]);

  useEffect(() => { setApplicants(null); load(); }, [load]);

  async function decide(creatorId, next, message) {
    setBusyId(creatorId);
    try {
      await api.decideApplicant(id, creatorId, next, message);
      await load();
      toast.push({
        shortlisted: 'Shortlisted',
        under_review: 'Moved back to review',
        selected: 'Creator selected — the collaboration is open',
        rejected: 'Application rejected',
      }[next] ?? 'Updated', 'success');
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  }

  const tabs = useMemo(() => {
    const total = Object.values(counts).reduce((n, v) => n + v, 0);
    return [
      { id: 'all', label: 'All', count: total },
      ...TAB_ORDER
        .filter((s) => counts[s])
        .map((s) => ({ id: s, label: brandStatusMeta(s).label, count: counts[s] })),
    ];
  }, [counts]);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <AppPage
      title="Applications"
      description={campaign?.title
        ? `For "${campaign.title}". Shortlisting is just a note to yourself — selecting is what opens a collaboration.`
        : 'Shortlisting is just a note to yourself — selecting is what opens a collaboration.'}
      loading={applicants === null}
      error={error}
      onRetry={load}
      isEmpty={applicants?.length === 0}
      emptyTitle={status === 'all' ? 'No applications yet' : 'Nothing in this state'}
      emptySub={status === 'all'
        ? 'Creators who apply appear here. Campaigns usually see their first applications within a day of going live.'
        : 'Clear the filter to see the rest.'}
      emptyIcon={<Users className="w-6 h-6" />}
      emptyAction={status !== 'all'
        ? <button onClick={() => setParam('status', 'all')} className="btn-outline mt-1">Show all</button>
        : null}
      actions={(
        <div className="flex flex-wrap gap-2">
          {campaign?.status && <StatusPill status={campaign.status} />}
          <Link to={`/campaigns/${id}`} className="btn-ghost text-sm">View campaign</Link>
          <Link to="/campaigns" className="btn-ghost text-sm">
            <ChevDown className="w-4 h-4 rotate-90" /> All campaigns
          </Link>
        </div>
      )}
      toolbar={(
        <div className="space-y-3">
          <FilterRail
            options={tabs}
            value={status}
            onChange={(v) => setParam('status', v)}
            label="Filter applications"
          />
          <div className="max-w-[240px]">
            <SelectField
              id="ap-sort"
              label="Sort by"
              value={sort}
              onChange={(v) => setParam('sort', v)}
              options={SORTS}
              placeholder=""
            />
          </div>
        </div>
      )}
      skeletonRows={3}
      width="max-w-[900px]"
    >
      <div className="space-y-4">
        {(applicants ?? []).map((a) => (
          <ApplicantCard
            key={a.creator}
            applicant={a}
            campaign={campaign}
            onDecide={decide}
            busy={busyId === a.creator}
          />
        ))}
      </div>
    </AppPage>
  );
}