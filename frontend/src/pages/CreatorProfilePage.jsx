import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import AppShell from '../components/AppShell';
import { VerifiedName, Rating, Avail } from '../components/ui';
import RequirementForm from '../components/deals/RequirementForm';
import { AnimatedNumber, Money, SkeletonCard, Progress } from '../components/feedback';
import { Mail, MapPin, Star, Play, Send, Bookmark, Platform, ChevLeft, Image, ShieldCheck, Check } from '../components/icons';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast, ErrorBlock, EmptyBlock } from '../lib/ui-state';
import { fmt } from '../lib/normalize';
import { rise, stagger, page as pageMotion, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';

/**
 * A creator, as a brand sees them — the page Route 2's selection decision is
 * made on, and the step before a requirement is sent.
 *
 * Earlier fixes kept here:
 *
 *  1. **The save state was always wrong on load.** `saved` initialised to
 *     `false` and nothing ever asked the server, so an already-shortlisted
 *     creator showed "Save creator" and clicking it produced a duplicate-save
 *     error. It now reads the saved list on mount.
 *
 *  2. **`dataSource` was a grey pill either way.** "Live data" from a connected
 *     account and "self-reported" numbers a creator typed in looked identical,
 *     which is the one distinction a brand paying for reach needs.
 *
 * What changed for Route 2:
 *
 *  3. **The verification badge could not be true.** It read `d.verified`, and
 *     `verified` is not a field on CreatorProfile — so every creator on the
 *     platform, verified or not, rendered unverified. The server now derives
 *     `verification.identity` and `verification.social` the same way the
 *     applicant review queue does, and this reads those.
 *
 *  4. **"Invite to collaborate" sent a brief with no brief in it** — a
 *     generated title, the cheapest rate-card line, and the string "To be
 *     agreed during negotiation" as the deliverables. It now opens
 *     `RequirementForm`, which is the actual Route 2 hand-off.
 *
 *  5. **Audience and track record were missing.** A brand approaching a
 *     stranger has less to go on than one reading an application, so the two
 *     things an application would have supplied — who the audience is, and
 *     whether this creator has finished work before — are shown here.
 */

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

  /**
   * Route 2's hand-off into the shared collaboration workflow. The deal the
   * form creates is the same Deal a campaign application produces — same
   * states, same negotiation, same escrow — so this navigates to the ordinary
   * deal page rather than anywhere special.
   */
  function onRequirementSent(deal) {
    setInviting(false);
    toast.push('Requirement sent — they can accept, decline or counter', 'success');
    nav(`/deals/${deal._id}`);
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
  const stats = d.stats ?? {};
  const verification = d.verification ?? {};
  /*
    The server's rating is computed across every brand-to-creator review, not
    just the page of reviews this component fetched, so it is the one to show.
    The fetched list is still what renders the individual comments below.
  */
  const avgRating = stats.rating ?? (reviews.length
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : null);
  const ratingCount = stats.ratingCount ?? reviews.length;
  const totalFollowers = (d.socialAccounts || []).reduce((s, p) => s + (p.followers ?? 0), 0);
  const audience = d.audience ?? {};
  const hasAudience = Boolean(audience.declaredAt) && [
    audience.locations, audience.ageRanges, audience.genders, audience.interests,
  ].some((a) => a?.length);

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
                      verified={Boolean(verification.identity)}
                      className="font-display font-extrabold text-xl text-ink"
                    />

                    {/*
                      Policy 13.1 levels, stated rather than reduced to one tick.
                      "Identity verified" and "social verified" are different
                      claims, and a brand paying a stranger should see which it
                      has. Policy 13.5 — the documents behind either are never
                      shown, and the server does not send them.
                    */}
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {[
                        ['identity', 'Identity verified', 'Phone and email confirmed'],
                        ['social', 'Social verified', 'Account ownership confirmed'],
                      ].map(([key, label, title]) => (
                        <span
                          key={key}
                          title={verification[key] ? title : 'Not verified yet'}
                          className={verification[key]
                            ? 'pill-done inline-flex items-center gap-1'
                            : 'pill-quiet inline-flex items-center gap-1'}
                        >
                          {verification[key] ? <Check className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                          {verification[key] ? label : `No ${key} verification`}
                        </span>
                      ))}
                    </div>
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

            {/* ── who watches them ──────────────────────────────────── */}
            {hasAudience && (
              <motion.section variants={withReducedMotion(rise, reduced)} className="card p-4 sm:p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                  <h2 className="font-display font-bold text-ink text-sm">Their audience</h2>
                  <span className="pill-quiet">Creator-declared</span>
                </div>
                {/*
                  Said plainly, once. No integration on the platform returns
                  demographic breakdowns — Instagram's account insights are
                  reach and engagement metrics — so this is the creator's own
                  description. Presenting it as measured would be the Policy
                  3.2 mistake `selfReportedMetrics` exists to prevent.
                */}
                <p className="text-xs text-muted leading-relaxed mb-3.5 max-w-prose">
                  Described by the creator, not measured from their accounts. Last stated{' '}
                  {new Date(audience.declaredAt).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}.
                </p>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3.5">
                  {[
                    ['Mostly in', audience.locations],
                    ['Mostly aged', audience.ageRanges],
                    ['Mostly', audience.genders],
                    ['Interested in', audience.interests],
                  ].filter(([, v]) => v?.length).map(([label, values]) => (
                    <div key={label}>
                      <dt className="text-xs font-semibold text-muted">{label}</dt>
                      <dd className="flex flex-wrap gap-1.5 mt-1.5">
                        {values.map((v) => <span key={v} className="chip capitalize">{v}</span>)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </motion.section>
            )}

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
                  Send a requirement <Send className="w-4 h-4" />
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

            {/*
              Track record. Counts only — the titles and the brands behind a
              creator's past collaborations belong to those brands too, and
              nobody agreed to appear on a public client list. The number is
              still what a brand approaching a stranger wants: has this person
              finished work here before.
            */}
            <motion.section variants={withReducedMotion(rise, reduced)} className="card p-4">
              <h2 className="font-display font-bold text-ink mb-3 text-sm">Track record</h2>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Collaborations', stats.completedCollaborations ?? 0, 'completed here'],
                  ['Rating', avgRating != null ? avgRating.toFixed(1) : '—',
                    ratingCount ? `from ${ratingCount}` : 'no reviews yet'],
                ].map(([label, value, note]) => (
                  <div key={label} className="rounded-xl2 border border-line p-3 min-w-0">
                    <div className="font-display font-extrabold text-ink text-lg tnum">{value}</div>
                    <div className="text-[11px] text-muted break-words">{label}</div>
                    <div className="text-[10px] text-muted mt-0.5 break-words">{note}</div>
                  </div>
                ))}
              </div>
              {stats.memberSince && (
                <p className="text-[11px] text-muted mt-3">
                  On Marqueiver since{' '}
                  {new Date(stats.memberSince).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}.
                </p>
              )}
            </motion.section>

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
                {avgRating != null && <Rating value={avgRating.toFixed(1)} count={`${ratingCount}`} />}
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
                  {/*
                    Spelled month, like every other date on this page. The
                    numeric `en-IN` default rendered "2/7/2026" next to "14 Aug
                    2026" and "Mar 2024" — and a bare d/m/y is ambiguous to half
                    the people reading it.
                  */}
                  <div className="text-[10px] text-muted mt-1 tnum">
                    {new Date(r.createdAt).toLocaleDateString('en-IN', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
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

      {/*
        Route 2's hand-off. The requirement is written here, not invented — see
        components/deals/RequirementForm.jsx.
      */}
      <RequirementForm
        open={inviting}
        onClose={() => setInviting(false)}
        creator={d}
        onSent={onRequirementSent}
      />
    </AppShell>
  );
}