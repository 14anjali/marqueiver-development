import { useState, useEffect } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LabelList } from 'recharts';
import { Link } from 'react-router-dom';
import AppPage from '../components/AppPage';
import { AnimatedNumber, Progress } from '../components/feedback';
import { Platform, Star, BarChart as BarIcon } from '../components/icons';
import { api } from '../lib/api';
import { EmptyBlock } from '../lib/ui-state';
import { rupee } from '../lib/normalize';
import { TOKEN, axis, grid, tooltip, bar, rupeeAxis } from '../lib/chart-theme';

/**
 * A creator's own numbers.
 *
 * The audience-share pie is gone. It coloured up to six platforms from an
 * arbitrary list of hexes belonging to no palette, which put identity into
 * colour alone across six categories — the same problem that got the
 * deals-by-state pie replaced, and it fails colourblind separation for the same
 * reason.
 *
 * Platform share is now a bar per platform with the platform's own brand mark
 * beside it. Identity comes from the logo, which is unambiguous, and magnitude
 * from the bar. `Progress` carries the share, so the comparison is still
 * immediate without asking anyone to compare angles.
 *
 * The `dataSource` badge stays and matters: a self-reported follower count and
 * a live one from a connected account are different claims, and a brand
 * deciding whether to pay for reach needs to know which it is looking at.
 *
 * ── Surfaces ────────────────────────────────────────────────────────────────
 *
 * Every section was the same flat `card`, including the earnings chart — which
 * sits directly beside the collaboration-count chart in a two-column grid, at
 * the same elevation, in the same frame. The page already knew the difference:
 * the earnings bars are drawn in `TOKEN.money` and the count bars in the brand
 * hue. But the distinction stopped at the ink and never reached the container,
 * so at a glance the two panels read as the same kind of thing.
 *
 * `panel-money` is the surface the design system reserves for rupees. Earnings
 * get it; the rest of the page gets `card-edge`. "Ochre is money" is only worth
 * having as a rule if the rule is applied where money actually is.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const Tile = ({ label, value, format, sub }) => (
  <div className="card-edge p-4">
    <div className="text-xs text-muted">{label}</div>
    <div className="font-display font-extrabold text-xl text-ink mt-1 tnum">
      {typeof value === 'number' ? <AnimatedNumber value={value} format={format} /> : value}
    </div>
    {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
  </div>
);

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true); setError(null);
    try { const { data } = await api.analytics(); setData(data); }
    catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const shapeError = !loading && !error && !data
    ? { message: 'The server returned an unexpected response for analytics.' }
    : null;

  const dealsChart = (data?.dealsByMonth || []).map((d) => ({ name: MONTHS[d.month - 1], deals: d.count }));
  const earningsChart = (data?.earningsByMonth || []).map((d) => ({ name: MONTHS[d.month - 1], amount: d.total }));

  const platforms = (data?.platformBreakdown || [])
    .slice()
    .sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0));
  const totalFollowers = platforms.reduce((sum, p) => sum + (p.followers ?? 0), 0);

  return (
    <AppPage
      title="Analytics"
      description="Your connected accounts and your real collaboration history. Nothing here is estimated."
      width="max-w-[1000px]"
      loading={loading}
      error={error ?? shapeError}
      onRetry={load}
      isEmpty={false}
      skeletonRows={3}
    >
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile
              label="Total audience"
              value={data.totalAudience ?? 0}
              format={(n) => n.toLocaleString('en-IN')}
              sub="Across connected platforms"
            />
            <Tile label="Avg. engagement" value={`${data.avgEngagement ?? 0}%`} />
            <Tile label="Creator score" value={`${data.creatorScore ?? 0}/100`} />
            <Tile
              label="Rating"
              value={data.reviews?.count
                // `average` is read defensively: `count` being present does not
                // guarantee it, and `undefined.toFixed()` would take the whole
                // page down rather than one tile.
                ? `${(data.reviews.average ?? 0).toFixed(1)} ★`
                : '—'}
              sub={data.reviews?.count
                ? `${data.reviews.count} review${data.reviews.count === 1 ? '' : 's'}`
                : 'No reviews yet'}
            />
          </div>

          {/* ── platforms ──────────────────────────────────────────────── */}
          <section className="card-edge p-4 sm:p-5">
            <h2 className="font-display font-bold text-ink text-sm mb-1">Platforms</h2>
            {!platforms.length ? (
              <EmptyBlock
                title="No accounts connected"
                sub="Connect Instagram, YouTube or Facebook and your real reach appears here instead of numbers you typed in."
                icon={<BarIcon className="w-6 h-6" />}
                action={<Link to="/profile" className="btn-brand mt-2">Connect an account</Link>}
              />
            ) : (
              <div className="space-y-3 mt-3">
                {platforms.map((p) => (
                  <div key={p.platform} className="flex items-center gap-3.5">
                    {/* The brand mark is the label — unambiguous, and it does
                        not rely on colour to say which platform this is. */}
                    <Platform name={p.platform} className="w-8 h-8 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-semibold text-ink capitalize">{p.platform}</span>
                        <span className="text-xs text-muted tnum">
                          {(p.followers ?? 0).toLocaleString('en-IN')} followers
                          {p.engagementRate ? ` · ${p.engagementRate}% eng.` : ''}
                        </span>
                      </div>
                      <Progress
                        value={p.followers ?? 0}
                        max={totalFollowers || 1}
                        tone="brand"
                      />
                    </div>
                    <span
                      className={p.dataSource === 'connected' ? 'pill-done shrink-0' : 'pill-quiet shrink-0'}
                      title={p.dataSource === 'connected'
                        ? 'Read from the connected account'
                        : 'Entered by you — not verified against the platform'}
                    >
                      {p.dataSource === 'connected' ? 'Live' : 'Self-reported'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── history ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <section className="card-edge p-4 sm:p-5">
              <h2 className="font-display font-bold text-ink text-sm mb-3">Collaborations by month</h2>
              {!dealsChart.length ? (
                <p className="text-sm text-muted py-8 text-center">
                  Not enough history yet — this fills in after your first month.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={dealsChart} margin={{ top: 14, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid {...grid} />
                    <XAxis dataKey="name" {...axis} />
                    <YAxis {...axis} allowDecimals={false} width={30} />
                    <Tooltip {...tooltip} formatter={(v) => [v, 'Collaborations']} />
                    <Bar dataKey="deals" {...bar(TOKEN.brand, false)}>
                      <LabelList dataKey="deals" position="top" style={{ fill: TOKEN.muted, fontSize: 11 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </section>

            {/* The money surface, for the one panel on this page that is money. */}
            <section className="panel-money rounded-xl2 p-4 sm:p-5">
              <h2 className="font-display font-bold text-ink text-sm mb-3">Earnings by month</h2>
              {!earningsChart.length ? (
                <p className="text-sm text-muted py-8 text-center">
                  Earnings appear once your first collaboration completes.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={earningsChart} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                    <CartesianGrid {...grid} />
                    <XAxis dataKey="name" {...axis} />
                    <YAxis {...axis} tickFormatter={rupeeAxis} width={52} />
                    <Tooltip {...tooltip} formatter={(v) => [rupee(v), 'Earned']} />
                    <Bar dataKey="amount" {...bar(TOKEN.money, false)} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </section>
          </div>

          <p className="text-xs text-muted leading-relaxed">
            Follower growth over time is not shown, because Marqueiver stores your
            current social numbers rather than a daily snapshot of them. Charting
            it would mean inventing the history.
          </p>
        </div>
      )}
    </AppPage>
  );
}
