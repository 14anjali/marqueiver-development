import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import AppPage from '../components/AppPage';
import { StatusPill, AnimatedNumber, Money } from '../components/feedback';
import { Users, Handshake, Mail, Send, ChevRight, Wallet } from '../components/icons';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { rupee } from '../lib/normalize';
import { rise, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';

/**
 * The landing screen after sign-in.
 *
 * The bug this fixes is in the numbers, not the layout. "Active deals" counted
 *
 *     ['escrow_funded', 'in_progress', 'submitted', 'revision']
 *
 * and `escrow_funded` is not a deal state — the real one is `escrow_pending`.
 * The third copy of that same mistake in this codebase. It made the tile
 * under-report, and a creator with work waiting on payment saw nothing at all
 * for it.
 *
 * `resolution` and `disputed` are also counted now: a disputed collaboration is
 * emphatically still active, and leaving it out of the only number on the page
 * is how it gets forgotten.
 */

/** States where the collaboration is live and needs attention. */
const ACTIVE_STATES = ['escrow_pending', 'in_progress', 'submitted', 'revision', 'resolution', 'disputed'];

/** States where the ball is in this user's court. */
const NEEDS_YOU = {
  brand: ['submitted', 'escrow_pending', 'resolution'],
  creator: ['invitation', 'in_progress', 'revision'],
};

const Tile = ({ label, value, sub, format, money = false, to }) => {
  const body = (
    <>
      <div className="text-xs text-muted">{label}</div>
      <div className={`font-display font-extrabold text-2xl sm:text-3xl mt-1 tnum ${money ? 'text-money-700' : 'text-ink'}`}>
        <AnimatedNumber value={Number(value) || 0} format={format} />
      </div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </>
  );
  const cls = money ? 'panel-money' : 'card p-5';
  return to
    ? <Link to={to} className={`${cls} block card-interactive`}>{body}</Link>
    : <div className={cls}>{body}</div>;
};

export default function DashboardPage() {
  const { user } = useAuth();
  const isBrand = user?.role !== 'creator';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deals, setDeals] = useState([]);
  const [earnings, setEarnings] = useState(null);
  const reduced = usePrefersReducedMotion();

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const [d, e] = await Promise.allSettled([
        api.myDeals(),
        isBrand ? Promise.resolve(null) : api.earnings(),
      ]);
      // Deals failing is a real error; earnings failing is not fatal to the page.
      if (d.status === 'fulfilled') setDeals(d.value.data || []);
      else setError(d.reason);
      if (e.status === 'fulfilled' && e.value) setEarnings(e.value.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [isBrand]);

  const active = deals.filter((d) => ACTIVE_STATES.includes(d.state));
  const completed = deals.filter((d) => d.state === 'completed').length;
  const waiting = deals.filter((d) => (NEEDS_YOU[isBrand ? 'brand' : 'creator'] ?? []).includes(d.state));
  const counterparts = new Set(deals.map((d) => (isBrand ? d.creator : d.brand))).size;

  const quickActions = [
    { to: '/discover', icon: Users, label: `Browse ${isBrand ? 'creators' : 'brands'}` },
    { to: '/campaigns', icon: Send, label: isBrand ? 'Manage campaigns' : 'Browse campaigns' },
    { to: '/messages', icon: Mail, label: 'Messages' },
    { to: '/deals', icon: Handshake, label: 'My deals' },
    ...(isBrand ? [] : [{ to: '/earnings', icon: Wallet, label: 'Wallet and earnings' }]),
  ];

  return (
    <AppPage
      title="Your dashboard"
      description={waiting.length
        ? `${waiting.length} collaboration${waiting.length === 1 ? '' : 's'} waiting on you.`
        : `Where your ${isBrand ? 'campaigns' : 'collaborations'} stand right now.`}
      width="max-w-[1400px]"
      loading={loading}
      error={error}
      onRetry={load}
      isEmpty={false}
      actions={(
        <Link to="/discover" className="btn-cta">
          {isBrand ? 'Find creators' : 'Find brands'} <Send className="w-4 h-4" />
        </Link>
      )}
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <Tile label="Active" value={active.length} sub="Live collaborations" to="/deals" />
        <Tile label="Completed" value={completed} sub="All time" />
        {isBrand ? (
          <>
            <Tile label="Total deals" value={deals.length} />
            <Tile label="Creators worked with" value={counterparts} sub="Unique" />
          </>
        ) : (
          <>
            <Tile label="Earned, lifetime" value={earnings?.totalEarned ?? 0} format={rupee} to="/earnings" />
            <Tile label="Held in escrow" value={earnings?.pendingPayout ?? 0} format={rupee} money sub="Releases on approval" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── waiting on you ─────────────────────────────────────────── */}
        <section className="lg:col-span-2 card p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="font-display font-bold text-ink text-sm">
              {waiting.length ? 'Waiting on you' : 'Recent collaborations'}
            </h2>
            <Link to="/deals" className="text-sm text-brand-600 hover:text-brand-700 inline-flex items-center gap-1 focusable px-1">
              View all <ChevRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {!deals.length ? (
            <div className="text-center py-10">
              <p className="text-sm text-muted">
                Nothing here yet.{' '}
                <Link to="/discover" className="text-brand-600 font-medium hover:text-brand-700">
                  Find {isBrand ? 'a creator' : 'a brand'} to work with.
                </Link>
              </p>
            </div>
          ) : (
            <div className="divide-y divide-line -mx-2">
              {(waiting.length ? waiting : deals).slice(0, 5).map((d) => (
                <motion.div key={d._id} variants={withReducedMotion(rise, reduced)}>
                  <Link
                    to={`/deals/${d._id}`}
                    className="flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-bg transition-colors focusable"
                  >
                    <span className="w-9 h-9 rounded-lg wash text-brand-600 grid place-items-center shrink-0" aria-hidden="true">
                      <Handshake className="w-4 h-4" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink truncate">{d.title}</div>
                      <Money amount={d.terms?.amount} className="text-xs" />
                    </div>
                    <StatusPill status={d.state} />
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </section>

        {/* ── quick actions ──────────────────────────────────────────── */}
        <section className="card p-5">
          <h2 className="font-display font-bold text-ink text-sm mb-3">Quick actions</h2>
          <div className="space-y-1">
            {quickActions.map(({ to, icon: Icon, label }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-bg transition-colors group focusable"
              >
                <Icon className="w-4.5 h-4.5 text-brand-600" />
                <span className="text-sm font-medium text-ink flex-1">{label}</span>
                <ChevRight className="w-4 h-4 text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </AppPage>
  );
}
