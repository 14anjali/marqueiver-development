import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../../../lib/api';
import { ErrorBlock } from '../../../lib/ui-state';
import { Money, Skeleton, StatusPill } from '../../feedback';
import { Users, Grid } from '../../icons';
import { rise, stagger, withReducedMotion, usePrefersReducedMotion } from '../../../lib/motion';
import { SectionCard } from '../shared';

/**
 * What this brand has actually done on the platform.
 *
 * ── Read from the real campaign and deal records ───────────────────────────
 *
 * There is no separate "brand portfolio" collection and this section does not
 * create one. A brand's track record already exists as its campaigns
 * (`GET /api/campaigns`, which returns the brand's own in every state) and its
 * collaborations (`GET /api/deals`). Duplicating that into a curated portfolio
 * array would mean two sources for the same facts, and the curated one would be
 * the one nobody updates.
 *
 * Nothing here is invented. A brand with no campaigns gets an empty state that
 * says so, not a placeholder case study.
 */
export default function PreviousWork({ profile }) {
  const [campaigns, setCampaigns] = useState(null);
  const [deals, setDeals] = useState(null);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    let alive = true;
    setError(null);

    Promise.all([
      api.listCampaigns().then(({ data }) => data ?? []),
      // Deals are the collaborations themselves. A failure here is not fatal to
      // the section — campaigns alone are still worth showing — so it degrades
      // to an empty list rather than taking the whole screen down.
      api.myDeals().then(({ data }) => data ?? []).catch(() => []),
    ])
      .then(([c, d]) => { if (alive) { setCampaigns(c); setDeals(d); } })
      .catch((e) => { if (alive) setError(e); });

    return () => { alive = false; };
  }, [nonce]);

  const stats = useMemo(() => {
    if (!campaigns || !deals) return null;
    const completed = deals.filter((d) => d.state === 'completed');
    return {
      campaigns: campaigns.length,
      live: campaigns.filter((c) => c.status === 'open').length,
      collaborations: deals.length,
      completed: completed.length,
      // Only money that actually moved: `escrow.releasedAt` is set on release,
      // so funds still held and refunds are both excluded by construction.
      paid: completed.reduce((sum, d) => sum + (Number(d.escrow?.amount) || 0), 0),
    };
  }, [campaigns, deals]);

  const loading = !campaigns || !deals;

  return (
    <div className="space-y-5">
      <SectionCard
        title="Your website"
        description="The portfolio most creators will actually look at."
      >
        {profile.website ? (
          <a
            href={profile.website}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700
                       hover:text-brand-800 focusable"
          >
            {profile.website.replace(/^https?:\/\//, '')} →
          </a>
        ) : (
          <p className="text-sm text-muted">
            No website on record. Add one in Business Information — it is also part of brand
            verification.
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="Track record"
        description="Counted from your real campaigns and collaborations, not entered by hand."
      >
        {error ? (
          <ErrorBlock error={error} onRetry={() => setNonce((n) => n + 1)} />
        ) : loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" aria-busy="true" aria-live="polite"
            aria-label="Loading your track record">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl2 border border-line p-4">
                <Skeleton className="h-7 w-16 rounded-lg" />
                <Skeleton className="h-3 w-20 rounded mt-2" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat value={stats.campaigns} label="Campaigns" hint={`${stats.live} live`} />
            <Stat value={stats.collaborations} label="Collaborations" hint={`${stats.completed} completed`} />
            <Stat value={stats.completed} label="Completed" hint="paid in full" />
            <Stat
              value={<Money amount={stats.paid} className="!text-lg sm:!text-xl" />}
              label="Paid to creators"
              hint="released from escrow"
            />
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Campaigns"
        description="Every campaign you have run, in the state it is in."
        actions={<Link to="/campaigns" className="btn-outline text-sm">Manage campaigns</Link>}
      >
        {loading ? (
          <div className="space-y-2.5" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-xl2 border border-line p-4">
                <Skeleton className="h-4 w-48 max-w-full rounded" />
                <Skeleton className="h-3 w-32 rounded mt-2" />
              </div>
            ))}
          </div>
        ) : !campaigns.length ? (
          <Empty
            icon={Grid}
            title="No campaigns yet"
            body="When you publish a campaign it appears here, and creators can see the ones that ran."
            action={<Link to="/campaigns" className="btn-brand mt-5 mx-auto justify-center">Create a campaign</Link>}
          />
        ) : (
          <motion.ul
            variants={withReducedMotion(stagger, reduced)}
            initial="hidden"
            animate="visible"
            className="space-y-2.5"
          >
            {campaigns.slice(0, 10).map((c) => (
              <motion.li
                key={c._id}
                variants={withReducedMotion(rise, reduced)}
                className="rounded-xl2 border border-line p-4 flex flex-col sm:flex-row sm:items-center gap-3
                           hover:border-brand-200 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink truncate">{c.title}</p>
                  <p className="text-xs text-muted mt-0.5">
                    {c.applicants?.length ?? 0} applicant{(c.applicants?.length ?? 0) === 1 ? '' : 's'}
                    {c.budget > 0 && <> · <Money amount={c.budget} className="!text-xs" /></>}
                    {c.createdAt && <> · {new Date(c.createdAt).toLocaleDateString('en-IN')}</>}
                  </p>
                </div>
                <StatusPill status={c.status} className="shrink-0 w-fit" />
              </motion.li>
            ))}
          </motion.ul>
        )}

        {campaigns?.length > 10 && (
          <p className="text-xs text-muted mt-3">and {campaigns.length - 10} more</p>
        )}
      </SectionCard>

      <SectionCard
        title="Creator collaborations"
        description="Deals you have run with creators. Completed ones are what a creator looks at when judging whether you are good to work with."
        actions={<Link to="/deals" className="btn-outline text-sm">Open deals</Link>}
      >
        {loading ? (
          <Skeleton className="h-16 w-full rounded-xl2" />
        ) : !deals.length ? (
          <Empty
            icon={Users}
            title="No collaborations yet"
            body="Once you invite a creator and fund a collaboration, it appears here."
          />
        ) : (
          <ul className="divide-y divide-line">
            {deals.slice(0, 8).map((d) => (
              <li key={d._id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-ink truncate">{d.title || 'Collaboration'}</p>
                  {d.terms?.amount > 0 && (
                    <p className="text-xs text-muted"><Money amount={d.terms.amount} className="!text-xs" /></p>
                  )}
                </div>
                <StatusPill status={d.state} className="shrink-0" />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function Stat({ value, label, hint }) {
  return (
    <div className="rounded-xl2 border border-line bg-bg/50 p-4 text-center">
      <p className="font-display font-extrabold text-lg sm:text-xl text-ink tnum">{value}</p>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted mt-1">{label}</p>
      <p className="text-[11px] text-muted mt-0.5">{hint}</p>
    </div>
  );
}

function Empty({ icon: Icon, title, body, action }) {
  return (
    <div className="rounded-xl2 border border-dashed border-line bg-gradient-to-br
                    from-brand-50/40 to-pink-50/30 p-8 text-center">
      <span className="w-12 h-12 rounded-xl2 bg-white border border-line grid place-items-center mx-auto">
        <Icon className="w-5 h-5 text-brand-400" />
      </span>
      <p className="font-display font-bold text-ink mt-4">{title}</p>
      <p className="text-sm text-muted mt-1.5 leading-relaxed max-w-sm mx-auto">{body}</p>
      {action}
    </div>
  );
}