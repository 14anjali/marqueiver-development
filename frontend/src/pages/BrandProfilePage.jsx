import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import AppShell from '../components/AppShell';
import { VerifiedName } from '../components/ui';
import { StatusPill, Money, Progress, SkeletonCard } from '../components/feedback';
import { Mail, MapPin, Star, Check, ShieldCheck } from '../components/icons';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorBlock, EmptyBlock, Spinner, useToast } from '../lib/ui-state';
import { rise, stagger, page as pageMotion, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';

/**
 * A brand, as a creator sees them — the page a creator decides whether to apply on.
 *
 * The fix that matters is the same one CampaignsPage already had: applications
 * were tracked in a local `Set`, so refreshing the page wiped it and "Apply now"
 * came back on a campaign the creator had already applied to. Pressing it then
 * produced a duplicate-application error from the server. Application state now
 * comes from `myApplication` on each campaign, which is what the server sends.
 *
 * The trust scores are also given the weight they deserve: payment reliability
 * is the single number a creator most wants before agreeing to work, and it was
 * one grey row among four.
 */
export default function BrandProfilePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const isCreator = user?.role === 'creator';
  const reduced = usePrefersReducedMotion();

  const [brand, setBrand] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [applying, setApplying] = useState(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      // No :id means a brand is viewing their own profile.
      const targetId = id || (await api.myProfile()).data?._id;
      const { data } = await api.getBrand(targetId);
      setBrand(data);
      if (data?.user) {
        api.listCampaignsForBrand(data.user)
          .then((r) => setCampaigns(r.data || []))
          .catch(() => {});
      }
    } catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function apply(campaignId) {
    setApplying(campaignId);
    try {
      const { data } = await api.applyToCampaign(campaignId);
      // Written back onto the campaign, so it survives a refresh.
      setCampaigns((list) => list.map((c) =>
        (c._id === campaignId ? { ...c, myApplication: data.application } : c)));
      toast.push('Application sent', 'success');
    } catch (e) {
      if (/already applied/i.test(e.message)) load();
      toast.push(e.message, 'error');
    } finally { setApplying(null); }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6" role="status" aria-live="polite">
          <span className="sr-only">Loading brand…</span>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
            <div className="space-y-4"><SkeletonCard /><SkeletonCard /></div>
            <div className="space-y-4"><SkeletonCard /></div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (error || !brand) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto py-10 px-4">
          <ErrorBlock error={error ?? { message: 'This brand profile could not be found.' }} onRetry={load} />
        </div>
      </AppShell>
    );
  }

  const n = brand;
  const verificationList = Object.entries(n.verifications || {}).filter(([, v]) => v);
  const trustRows = [
    ['Payment reliability', n.trust?.paymentReliability],
    ['Communication', n.trust?.communication],
    ['Campaign experience', n.trust?.campaignExperience],
    ['Repeat collaboration', n.trust?.repeatCollaboration],
  ].filter(([, v]) => typeof v === 'number');

  return (
    <AppShell>
      <motion.div
        variants={withReducedMotion(pageMotion, reduced)}
        initial="hidden" animate="visible"
        className="max-w-[1100px] mx-auto px-4 sm:px-6 py-5 sm:py-6"
      >
        <motion.div
          variants={withReducedMotion(stagger, reduced)}
          initial="hidden" animate="visible"
          className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5"
        >
          <div className="space-y-4 min-w-0">
            {/* ── hero ──────────────────────────────────────────────── */}
            <motion.section variants={withReducedMotion(rise, reduced)} className="card overflow-hidden">
              <div className="relative h-28 sm:h-32 bg-gradient-to-br from-brand-600 via-brand-700 to-pink-500">
                <span className="absolute inset-0 opacity-40 bg-[radial-gradient(120%_120%_at_80%_0%,rgba(255,255,255,.45),transparent_55%)]" aria-hidden="true" />
              </div>

              <div className="px-4 sm:px-5 pb-5">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4 -mt-10 sm:-mt-12">
                  <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-white border-4 border-white shadow-raised grid place-items-center overflow-hidden shrink-0">
                    {n.logo
                      ? <img src={n.logo} className="w-full h-full object-cover" alt="" />
                      : <span className="font-display font-extrabold text-2xl text-brand-600">{(n.companyName || '?')[0]}</span>}
                  </div>

                  <div className="flex-1 min-w-0 sm:pt-12">
                    {verificationList.length > 0 && (
                      <span className="pill-done mb-1.5 inline-flex">
                        <ShieldCheck className="w-3 h-3" /> Verified brand
                      </span>
                    )}
                    {/* The pill above and the tick here now agree: both come from
                        `verificationList`. The tick used to render regardless. */}
                    <VerifiedName
                      name={n.companyName}
                      verified={verificationList.length > 0}
                      className="font-display font-extrabold text-xl sm:text-2xl text-ink"
                    />
                    {n.industry && <p className="text-sm text-muted mt-0.5">{n.industry}</p>}

                    <div className="flex items-center gap-3 mt-2 text-sm text-muted flex-wrap">
                      {(n.location?.city || n.location?.country) && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" />
                          {[n.location?.city, n.location?.country].filter(Boolean).join(', ')}
                        </span>
                      )}
                      {n.website && (
                        <a
                          href={n.website.startsWith('http') ? n.website : `https://${n.website}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-brand-600 hover:text-brand-700 underline focusable"
                        >
                          {n.website.replace(/^https?:\/\//, '')}
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {n.about && <p className="text-sm text-ink mt-4 leading-relaxed max-w-prose">{n.about}</p>}

                {n.trust?.reviewCount > 0 && (
                  <div className="flex items-center gap-1.5 mt-4 text-sm">
                    <Star className="w-4 h-4 text-money-500" />
                    <span className="font-semibold text-ink tnum">{n.trust.overall?.toFixed(1)}</span>
                    <span className="text-muted">
                      from {n.trust.reviewCount} creator{n.trust.reviewCount === 1 ? '' : 's'}
                    </span>
                  </div>
                )}
              </div>
            </motion.section>

            {(n.companySize || n.foundedYear) && (
              <motion.section variants={withReducedMotion(rise, reduced)} className="card p-4 sm:p-5">
                <h2 className="font-display font-bold text-ink text-sm mb-2">About {n.companyName}</h2>
                {[['Founded', n.foundedYear], ['Company size', n.companySize], ['Industry', n.industry]]
                  .filter(([, v]) => v)
                  .map(([a, b]) => (
                    <div key={a} className="flex justify-between gap-3 py-2 border-b border-line last:border-0 text-sm">
                      <span className="text-muted inline-flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-brand-500" />{a}
                      </span>
                      <span className="font-medium text-ink text-right">{b}</span>
                    </div>
                  ))}
              </motion.section>
            )}

            {/* ── open campaigns ────────────────────────────────────── */}
            <motion.section variants={withReducedMotion(rise, reduced)} className="card p-4 sm:p-5">
              <h2 className="font-display font-bold text-ink text-sm mb-3">Open campaigns</h2>
              {!campaigns.length ? (
                <EmptyBlock
                  title="No open campaigns"
                  sub={isCreator
                    ? 'Nothing to apply to right now. Message the brand if you would like to work with them.'
                    : 'This brand has no live campaigns.'}
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {campaigns.map((c) => {
                    const mine = c.myApplication;
                    return (
                      <div key={c._id} className="rounded-xl2 border border-line p-3.5 flex flex-col">
                        <div className="font-semibold text-sm text-ink leading-snug">{c.title}</div>
                        {c.tags?.length > 0 && (
                          <div className="flex gap-1.5 my-2 flex-wrap">
                            {c.tags.slice(0, 3).map((t) => <span key={t} className="chip">{t}</span>)}
                          </div>
                        )}
                        <div className="text-[11px] text-muted inline-flex items-center gap-1 mt-auto pt-1.5">
                          <MapPin className="w-3 h-3" />{c.location}
                        </div>
                        <Money amount={c.budget} className="text-sm mt-1" />

                        {isCreator && (
                          mine ? (
                            <span className="mt-2.5">
                              <StatusPill status={
                                mine.status === 'accepted' ? 'completed'
                                  : mine.status === 'rejected' ? 'declined'
                                    : 'pending_review'
                              } />
                            </span>
                          ) : (
                            <button
                              onClick={() => apply(c._id)}
                              disabled={applying === c._id || c.status !== 'open'}
                              className="btn-brand w-full mt-2.5 text-xs py-2 disabled:opacity-50"
                            >
                              {applying === c._id ? <Spinner className="w-3.5 h-3.5" /> : 'Apply now'}
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.section>
          </div>

          {/* ── sidebar ─────────────────────────────────────────────── */}
          <div className="space-y-4">
            {isCreator && (
              <motion.section variants={withReducedMotion(rise, reduced)} className="card p-4">
                <h2 className="font-semibold text-ink text-sm">Interested in working together?</h2>
                <p className="text-xs text-muted mt-1 mb-3 leading-relaxed">
                  Apply to a campaign above, or message the brand directly.
                </p>
                <button onClick={() => nav('/messages')} className="btn-outline w-full">
                  <Mail className="w-4 h-4" /> Message brand
                </button>
              </motion.section>
            )}

            {trustRows.length > 0 && (
              <motion.section variants={withReducedMotion(rise, reduced)} className="card p-4">
                <h2 className="font-display font-bold text-ink mb-3 text-sm">Trust score</h2>
                <div className="flex items-center gap-3 mb-4">
                  <span className="w-11 h-11 rounded-full bg-jade-50 text-jade-600 grid place-items-center shrink-0" aria-hidden="true">
                    <Check className="w-5 h-5" />
                  </span>
                  <span className="font-display font-extrabold text-2xl text-ink tnum">
                    {(n.trust.overall ?? 0).toFixed(1)}<span className="text-muted text-base font-normal">/5</span>
                  </span>
                </div>

                {/*
                  Payment reliability leads and is drawn, not just numbered: it
                  is the thing a creator most wants to know before agreeing to
                  work, and a row of four identical grey lines buried it.
                */}
                <div className="space-y-2.5">
                  {trustRows.map(([label, value], i) => (
                    <Progress
                      key={label}
                      value={value} max={5}
                      tone={i === 0 ? 'money' : 'brand'}
                      label={`${label} · ${value.toFixed(1)}/5`}
                    />
                  ))}
                </div>
              </motion.section>
            )}

            {verificationList.length > 0 && (
              <motion.section variants={withReducedMotion(rise, reduced)} className="card p-4">
                <h2 className="font-display font-bold text-ink mb-3 text-sm">Verified</h2>
                {verificationList.map(([v]) => (
                  <div key={v} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-muted capitalize">{v}</span>
                    <Check className="w-4 h-4 text-jade-600" />
                  </div>
                ))}
              </motion.section>
            )}

            {n.teamMembers?.length > 0 && (
              <motion.section variants={withReducedMotion(rise, reduced)} className="card p-4">
                <h2 className="font-display font-bold text-ink mb-3 text-sm">Team</h2>
                {n.teamMembers.map((m) => (
                  <div key={m.name} className="flex items-center gap-3 py-2">
                    <span className="w-9 h-9 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-xs font-bold shrink-0">
                      {m.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ink truncate">{m.name}</div>
                      <div className="text-[11px] text-muted truncate">{m.role}</div>
                    </div>
                  </div>
                ))}
              </motion.section>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AppShell>
  );
}
