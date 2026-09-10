import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import AppPage, { FilterRail } from '../components/AppPage';
import { StatusPill, Money } from '../components/feedback';
import { Handshake, ChevRight } from '../components/icons';
import { api } from '../lib/api';
import { rise, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';

/**
 * Every collaboration this account is part of.
 *
 * Two things the redesign fixed beyond the look:
 *
 *  1. **The status colours were a third copy.** This page, AdminDeals and
 *     AdminDashboard each kept their own map of deal state to colour, and they
 *     disagreed. They now all use `StatusPill`, so a deal cannot be amber here
 *     and blue on the admin screen.
 *
 *  2. **Three states could not be filtered to.** The rail listed ten of the
 *     twelve states and omitted `disputed`, `declined` and `cancelled` — so a
 *     creator with a disputed deal had no way to filter to it, and the counts
 *     never added up to the list they were looking at. The rail is now built
 *     from the deals actually present, with a count on each chip.
 */

/** Lifecycle order, so the rail reads as a progression rather than a bag. */
const STATE_ORDER = [
  'invitation', 'negotiation', 'accepted', 'escrow_pending', 'in_progress',
  'submitted', 'revision', 'resolution', 'disputed', 'completed',
  'declined', 'cancelled',
];

const LABEL = {
  escrow_pending: 'Awaiting payment',
  in_progress: 'In progress',
  resolution: 'Resolution',
  invitation: 'Invited',
  negotiation: 'Negotiating',
};
const labelFor = (s) => LABEL[s] ?? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export default function DealsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deals, setDeals] = useState([]);
  const [filter, setFilter] = useState('all');
  const reduced = usePrefersReducedMotion();

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.myDeals(); setDeals(data || []); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  /**
   * Chips for the states that actually occur, in lifecycle order, each with its
   * count. A chip that leads to an empty list is a chip that should not be there.
   */
  const filters = useMemo(() => {
    const counts = deals.reduce((acc, d) => {
      acc[d.state] = (acc[d.state] ?? 0) + 1;
      return acc;
    }, {});
    return [
      { id: 'all', label: 'All', count: deals.length },
      ...STATE_ORDER
        .filter((s) => counts[s])
        .map((s) => ({ id: s, label: labelFor(s), count: counts[s] })),
    ];
  }, [deals]);

  const shown = filter === 'all' ? deals : deals.filter((d) => d.state === filter);

  return (
    <AppPage
      title="My deals"
      description="Every collaboration and where its money currently sits."
      loading={loading}
      error={error}
      onRetry={load}
      isEmpty={!shown.length}
      emptyTitle={filter === 'all' ? 'No deals yet' : `Nothing in ${labelFor(filter).toLowerCase()}`}
      emptySub={filter === 'all'
        ? 'Deals appear here when you invite a creator, apply to a campaign, or receive an invitation.'
        : 'Your other deals are still there — clear the filter to see them.'}
      emptyAction={filter === 'all'
        ? <Link to="/discover" className="btn-cta mt-2">Find creators</Link>
        : <button onClick={() => setFilter('all')} className="btn-outline mt-1">Show all deals</button>}
      emptyIcon={<Handshake className="w-6 h-6" />}
      toolbar={deals.length > 1 && (
        <FilterRail options={filters} value={filter} onChange={setFilter} label="Filter deals by state" />
      )}
    >
      <div className="space-y-2.5">
        {shown.map((d) => (
          <motion.div key={d._id} variants={withReducedMotion(rise, reduced)}>
            <Link to={`/deals/${d._id}`} className="card-interactive p-4 flex items-center gap-3.5 sm:gap-4">
              <span
                className="w-11 h-11 rounded-xl2 wash text-brand-600 grid place-items-center shrink-0"
                aria-hidden="true"
              >
                <Handshake className="w-5 h-5" />
              </span>

              <div className="flex-1 min-w-0">
                <div className="font-semibold text-ink truncate">{d.title}</div>
                <div className="text-sm text-muted flex items-center gap-1.5 flex-wrap mt-0.5">
                  <Money amount={d.terms?.amount} className="text-sm" />
                  {d.contentTypes?.length > 0 && (
                    <>
                      <span className="text-line">·</span>
                      <span className="truncate">{d.contentTypes.join(', ')}</span>
                    </>
                  )}
                </div>
                {/* The pill moves under the title on a phone rather than
                    squeezing the deal name to nothing. */}
                <span className="sm:hidden mt-2 inline-flex">
                  <StatusPill status={d.state} />
                </span>
              </div>

              <span className="hidden sm:inline-flex shrink-0">
                <StatusPill status={d.state} />
              </span>
              <ChevRight className="w-4 h-4 text-muted shrink-0" aria-hidden="true" />
            </Link>
          </motion.div>
        ))}
      </div>
    </AppPage>
  );
}
