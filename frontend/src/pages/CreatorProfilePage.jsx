import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import AppShell from '../components/AppShell';
import { VerifiedName, Rating, Avail } from '../components/ui';
import { Modal } from '../components/overlay';
import { AnimatedNumber, Money, SkeletonCard, Progress } from '../components/feedback';
import { Mail, MapPin, Star, Play, Send, Bookmark, Platform, ChevLeft, Image } from '../components/icons';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast, Spinner, ErrorBlock, EmptyBlock } from '../lib/ui-state';
import { rupee, fmt } from '../lib/normalize';
import { rise, stagger, page as pageMotion, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';

/**
 * A creator, as a brand sees them. The page a shortlisting decision is made on.
 *
 * Three real fixes:
 *
 *  1. **The save state was always wrong on load.** `saved` initialised to
 *     `false` and nothing ever asked the server, so an already-shortlisted
 *     creator showed "Save creator" and clicking it produced a duplicate-save
 *     error. It now reads the saved list on mount.
 *
 *  2. **"Invite to campaign" fired instantly with invented terms** — no
 *     confirmation, `revisionsAllowed: 1` hardcoded against a platform standard
 *     of 3, and `deliverables: 'To be discussed'`. One click created a real deal
 *     and navigated away from the page. It now opens a dialog showing exactly
 *     what will be created.
 *
 *  3. **`dataSource` was a grey pill either way.** "Live data" from a connected
 *     account and "self-reported" numbers a creator typed in looked identical,
 *     which is the one distinction a brand paying for reach needs.
 */

/** Platform-standard revisions, matching INCLUDED_REVISIONS on the server. */
const DEFAULT_REVISIONS = 3;

export default function CreatorProfilePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const isBrand = user?.role === 'brand';
  const reduced = usePrefersReducedMotion();

  const [profile, setProfile] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [inviting, setInviting] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await api.getCreator(id);
      setProfile(data.profile);
      if (data.profile?.user) {
        api.reviewsForUser(data.profile.user)
          .then((r) => setReviews(r.data || []))
          .catch(() => {});
      }
    } catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // The save state has to come from the server, not from an optimistic default.
  useEffect(() => {
    if (!isBrand || !id) return;
    api.listSavedCreators()
      .then(({ data }) => setSaved((data || []).some((c) => c._id === id || c.user === profile?.user)))
      .catch(() => {});
  }, [isBrand, id, profile?.user]);

  async function invite() {
    if (!profile?.user) return;
    setBusy(true);
    try {
      const { data } = await api.createDeal({
        creatorId: profile.user,
        title: `Collaboration with ${profile.displayName}`,
        contentTypes: profile.contentTypes?.length ? profile.contentTypes : ['reel'],
        amount: profile.rateCard?.[0]?.price || 0,
        deliverables: 'To be agreed during negotiation',
        revisionsAllowed: DEFAULT_REVISIONS,
      });
      toast.push('Invitation sent', 'success');
      nav(`/deals/${data._id}`);
    } catch (e) { toast.push(e.message, 'error'); setBusy(false); }
  }

  async function toggleSave() {
    if (!isBrand || !id) return;
    const next = !saved;
    setSaved(next); // optimistic — a heart that lags reads as broken
    try {
      if (next) await api.saveCreator(id); else await api.unsaveCreator(id);
    } catch (e) {
      setSaved(!next);
      toast.push(e.message, 'error');
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6" role="status" aria-live="polite">
          <span className="sr-only">Loading profile…</span>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
            <div className="space-y-4"><SkeletonCard /><SkeletonCard /></div>
            <div className="space-y-4"><SkeletonCard /></div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (error || !profile) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto py-10 px-4">
          <ErrorBlock
            error={error ?? { message: 'This creator profile could not be found.' }}
            onRetry={load}
          />
        </div>
      </AppShell>
    );
  }

  const d = profile;
  const startingRate = d.rateCard?.[0]?.price ?? 0;
  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length)
    : null;
  const totalFollowers = (d.socialAccounts || []).reduce((s, p) => s + (p.followers ?? 0), 0);

  return (
    <AppShell>
      <motion.div
        variants={withReducedMotion(pageMotion, reduced)}
        initial="hidden" animate="visible"
        className="max-w-[1400px] mx-auto px-4 sm:px-6 py-4 sm:py-6"
      >
        <button
          onClick={() => nav('/discover')}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink mb-3 transition-colors focusable px-1 py-1"
        >
          <ChevLeft className="w-4 h-4" /> Back to search
        </button>

        <motion.div
          variants={withReducedMotion(stagger, reduced)}
          initial="hidden" animate="visible"
          className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5"
        >
          <div className="space-y-4 min-w-0">
            {/* ── hero ──────────────────────────────────────────────── */}
            <motion.section variants={withReducedMotion(rise, reduced)} className="card overflow-hidden">
              <div className="relative h-28 sm:h-32 bg-gradient-to-br from-brand-600 via-brand-500 to-pink-500">
                <span className="absolute inset-0 opacity-40 bg-[radial-gradient(120%_120%_at_20%_0%,rgba(255,255,255,.5),transparent_55%)]" aria-hidden="true" />
              </div>

              <div className="px-4 sm:px-5 pb-5">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4 -mt-10 sm:-mt-12">
                  <div className="relative shrink-0">
                    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full border-4 border-white bg-brand-100 grid place-items-center text-2xl font-display font-extrabold text-brand-700 shadow-raised">
                      {(d.displayName || '?').slice(0, 1).toUpperCase()}
                    </div>
                    {/* `Avail` decides what to say now, and says nothing when
                        availability is unknown — see components/ui.jsx. */}
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2">
                      <Avail available={d.availability} />
                    </span>
                  </div>

                  <div className="flex-1 min-w-0 sm:pt-12">
                    <VerifiedName
                      name={d.displayName}
                      verified={Boolean(d.verified)}
                      className="font-display font-extrabold text-xl text-ink"
                    />
                    {d.headline && <p className="text-sm text-muted mt-0.5">{d.headline}</p>}
                    {(d.location?.city || d.location?.country) && (
                      <p className="inline-flex items-center gap-1 text-sm text-muted mt-1">
                        <MapPin className="w-3.5 h-3.5" />
                        {[d.location?.city, d.location?.country].filter(Boolean).join(', ')}
                      </p>
                    )}
                    {d.categories?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {d.categories.map((t) => <span key={t} className="chip">{t}</span>)}
                      </div>
                    )}
                  </div>

                  <div className="hidden xl:flex gap-6 pt-12 text-center shrink-0">
                    {[
                      [<AnimatedNumber key="a" value={d.totalAudience ?? 0} format={fmt} />, 'Total audience'],
                      [`${d.creatorScore ?? 0}/100`, 'Creator score'],
                      [`${d.responseTimeHrs ?? 24}h`, 'Responds in'],
                    ].map(([v, l]) => (
                      <div key={l}>
                        <div className="font-display font-extrabold text-lg text-ink tnum">{v}</div>
                        <div className="text-[11px] text-muted">{l}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {d.bio && <p className="text-sm text-ink mt-4 leading-relaxed max-w-prose">{d.bio}</p>}
              </div>
            </motion.section>

            {/* ── social reach ──────────────────────────────────────── */}
            <motion.section variants={withReducedMotion(rise, reduced)} className="card p-4 sm:p-5">
              <h2 className="font-display font-bold text-ink text-sm mb-3">Social reach</h2>
              {!d.socialAccounts?.length ? (
                <EmptyBlock
                  title="No connected accounts"
                  sub="This creator has not connected a social account, so their reach cannot be verified."
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {d.socialAccounts.map((p) => {
                    const live = p.dataSource === 'connected';
                    return (
                      <div key={p.platform} className="border border-line rounded-xl2 p-4">
                        <div className="flex items-center gap-2.5">
                          <Platform name={p.platform} className="w-8 h-8 shrink-0" />
                          <div className="min-w-0">
                            <div className="font-semibold text-ink text-sm capitalize">{p.platform}</div>
                            <div className="text-[11px] text-muted truncate">{p.handle}</div>
                          </div>
                        </div>
                        <div className="font-display font-extrabold text-2xl text-ink mt-3 tnum">
                          <AnimatedNumber value={p.followers ?? 0} format={fmt} />
                        </div>
                        <div className="text-[11px] text-muted">
                          Followers · {p.engagementRate ?? 0}% engagement
                        </div>
                        {totalFollowers > 0 && (
                          <Progress value={p.followers ?? 0} max={totalFollowers} className="mt-2.5" />
                        )}
                        {/*
                          Live and self-reported are different claims. A brand
                          paying for reach needs to see which it is looking at.
                        */}
                        <span className={live ? 'pill-done mt-2.5 inline-flex' : 'pill-quiet mt-2.5 inline-flex'}>
                          {live ? 'Verified from account' : 'Self-reported'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.section>

            {/* ── portfolio ─────────────────────────────────────────── */}
            <motion.section variants={withReducedMotion(rise, reduced)} className="card p-4 sm:p-5">
              <h2 className="font-display font-bold text-ink text-sm mb-3">Portfolio</h2>
              {!d.portfolio?.length ? (
                <EmptyBlock
                  title="No work samples yet"
                  sub="This creator has not uploaded any portfolio items."
                  icon={<Image className="w-6 h-6" />}
                />
              ) : (
                <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
                  {d.portfolio.map((item) => (
                    <figure
                      key={item._id}
                      className="relative w-32 h-44 rounded-xl2 overflow-hidden shrink-0 bg-bg border border-line
                                 transition-transform duration-300 hover:scale-[1.03]"
                    >
                      <img
                        src={item.thumbnailUrl || item.mediaUrl}
                        alt={item.title || 'Work sample'}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                      {item.mediaType === 'video' && (
                        <span className="absolute bottom-2 left-2 text-white bg-black/45 rounded px-1.5 py-1 backdrop-blur-sm">
                          <Play className="w-3 h-3" />
                        </span>
                      )}
                    </figure>
                  ))}
                </div>
              )}
            </motion.section>
          </div>

          {/* ── sidebar ─────────────────────────────────────────────── */}
          <div className="space-y-4">
            {isBrand && (
              <motion.div variants={withReducedMotion(rise, reduced)} className="space-y-2">
                <button onClick={() => setInviting(true)} className="btn-cta w-full py-3">
                  Invite to collaborate <Send className="w-4 h-4" />
                </button>
                <button onClick={() => nav('/messages')} className="btn-outline w-full">
                  <Mail className="w-4 h-4" /> Message
                </button>
                <button
                  onClick={toggleSave}
                  aria-pressed={saved}
                  className={`btn-ghost w-full bg-white transition-colors ${saved ? 'text-pink-600 border-pink-200' : ''}`}
                >
                  <Bookmark className="w-4 h-4" /> {saved ? 'Shortlisted' : 'Shortlist'}
                </button>
              </motion.div>
            )}

            <motion.section variants={withReducedMotion(rise, reduced)} className="card p-4 text-sm">
              <h2 className="font-display font-bold text-ink mb-3 text-sm">Availability</h2>
              <p className={`font-medium mb-2 ${d.availability ? 'text-jade-700' : 'text-muted'}`}>
                {d.availability ? 'Open to new collaborations' : 'Not currently available'}
              </p>
              {[
                ['Collaboration types', (d.collaborationTypes || []).join(' / ') || '—'],
                ['Content types', (d.contentTypes || []).join(', ') || '—'],
              ].map(([a, b]) => (
                <div key={a} className="flex justify-between gap-3 py-1.5 border-b border-line last:border-0">
                  <span className="text-muted shrink-0">{a}</span>
                  <span className="text-ink font-medium text-right">{b}</span>
                </div>
              ))}
            </motion.section>

            <motion.section variants={withReducedMotion(rise, reduced)} className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display font-bold text-ink text-sm">Reviews</h2>
                {avgRating !== null && <Rating value={avgRating.toFixed(1)} count={`${reviews.length}`} />}
              </div>
              {!reviews.length ? (
                <p className="text-xs text-muted leading-relaxed">
                  No reviews yet. Reviews appear once a collaboration completes and both sides have rated.
                </p>
              ) : reviews.slice(0, 3).map((r) => (
                <div key={r._id} className="py-2.5 border-b border-line last:border-0">
                  <span className="flex gap-0.5 text-money-500 mb-1" aria-label={`${r.rating} out of 5`}>
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className={`w-3 h-3 ${i >= r.rating ? 'opacity-20' : ''}`} />
                    ))}
                  </span>
                  {r.text && <p className="text-xs text-muted leading-relaxed">{r.text}</p>}
                  <div className="text-[10px] text-muted mt-1 tnum">
                    {new Date(r.createdAt).toLocaleDateString('en-IN')}
                  </div>
                </div>
              ))}
            </motion.section>

            {d.rateCard?.length > 0 && (
              <motion.section variants={withReducedMotion(rise, reduced)} className="panel-money">
                <h2 className="font-display font-bold text-money-700 mb-3 text-sm">Rates, from</h2>
                {d.rateCard.map((r) => (
                  <div key={r.contentType} className="flex justify-between items-baseline py-1.5 border-b border-money-100 last:border-0">
                    <span className="text-muted capitalize text-sm">{r.contentType}</span>
                    <Money amount={r.price} className="text-sm" />
                  </div>
                ))}
              </motion.section>
            )}
          </div>
        </motion.div>
      </motion.div>

      {/* Nothing is created until this is confirmed. */}
      <Modal
        open={inviting}
        onClose={busy ? undefined : () => setInviting(false)}
        dismissible={!busy}
        title={`Invite ${d.displayName}?`}
        description="This creates a collaboration and opens negotiation. Nothing is charged and no terms are binding until you both confirm them."
        size="sm"
        footer={(
          <>
            <button data-autofocus onClick={() => setInviting(false)} disabled={busy} className="btn-ghost">
              Cancel
            </button>
            <button onClick={invite} disabled={busy} className="btn-cta">
              {busy ? <><Spinner className="w-4 h-4" /> Sending…</> : 'Send invitation'}
            </button>
          </>
        )}
      >
        <dl className="text-sm space-y-2">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Opening amount</dt>
            <dd>{startingRate ? <Money amount={startingRate} className="text-sm" /> : <span className="text-muted">To be agreed</span>}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Content</dt>
            <dd className="text-ink text-right">{(d.contentTypes?.length ? d.contentTypes : ['reel']).join(', ')}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Included revisions</dt>
            <dd className="text-ink tnum">{DEFAULT_REVISIONS}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted mt-3 leading-relaxed">
          {startingRate
            ? 'Taken from their rate card as an opening position — you can negotiate from there.'
            : 'This creator has no rate card, so the amount is settled in negotiation.'}
        </p>
      </Modal>
    </AppShell>
  );
}
