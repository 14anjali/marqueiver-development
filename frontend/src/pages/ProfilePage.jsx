import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import AppShell from '../components/AppShell';
import AccountSettings from '../components/profile/AccountSettings';
import ProfileNav, { SECTIONS, BRAND_SECTIONS } from '../components/profile/ProfileNav';
import { profileCompleteness } from '../components/profile/completeness';
import { brandCompleteness } from '../components/profile/brandCompleteness';
import { SectionCard } from '../components/profile/shared';

import Overview from '../components/profile/sections/Overview';
import PersonalInfo from '../components/profile/sections/PersonalInfo';
import SocialMedia from '../components/profile/sections/SocialMedia';
import Portfolio from '../components/profile/sections/Portfolio';
import WorkPreferences from '../components/profile/sections/WorkPreferences';
import RateCard from '../components/profile/sections/RateCard';
import BankPayments from '../components/profile/sections/BankPayments';
import Verification from '../components/profile/sections/Verification';

import BrandOverview from '../components/profile/brand/BrandOverview';
import BusinessInformation from '../components/profile/brand/BusinessInformation';
import BrandIdentity from '../components/profile/brand/BrandIdentity';
import BrandSocial from '../components/profile/brand/BrandSocial';
import PreviousWork from '../components/profile/brand/PreviousWork';
import CampaignPreferences from '../components/profile/brand/CampaignPreferences';
import PaymentBilling from '../components/profile/brand/PaymentBilling';
import BrandVerification from '../components/profile/brand/BrandVerification';

import { SkeletonList } from '../components/feedback';
import { ErrorBlock, useToast } from '../lib/ui-state';
import { FileText, Image as ImageIcon, BarChart, Wallet } from '../components/icons';
import { page, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

/**
 * The Creator Profile and Account Center.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * One 570-line scroll holding everything: identity, preferences, rate card,
 * three social cards, a media-kit block and the destructive account controls,
 * all stacked. Finding the rate card meant scrolling past two platform
 * integrations, and "Save changes" and "Save preferences" were different
 * buttons saving different subsets of the same form, several screens apart.
 *
 * It is nine sections now, and the split is by *what the thing is* rather than
 * by what the API endpoint happens to be — Personal Information saves through
 * the same `PATCH /me/creator` as Work Preferences and Rate Card do, but they
 * are three unrelated jobs and putting them on one screen only ever made the
 * screen longer.
 *
 * ── Overview is read-only, deliberately ─────────────────────────────────────
 *
 * It is the answer to "what do brands actually see about me", which is the
 * question people open this page with. A preview that is also a form is neither:
 * the fields look like inputs so it cannot be trusted as a preview, and the
 * fields belong to eight different groups so it is useless as a form. Each
 * block carries an Edit that moves to the section that owns it.
 *
 * ── The section lives in the URL ────────────────────────────────────────────
 *
 * `?section=rates` rather than component state, so the browser Back button
 * moves between sections, a section can be linked to from elsewhere in the
 * product, and a reload stays where the user was. The completeness meter links
 * straight into the section that would improve it, which only works because of
 * this.
 *
 * ── Two roles, one route, two centres ───────────────────────────────────────
 *
 * This route serves both. `CreatorAccountCenter` and `BrandAccountCenter` share
 * the shell — `ProfileNav`, the section frame, the completeness meter, the
 * `?section=` URL — and nothing else, because the field sets barely overlap. A
 * creator has a rate card and languages; a brand has a GSTIN and campaign
 * preferences. One component branching on role through every section would be
 * harder to read than two that each say what they mean.
 */
export default function ProfilePage() {
  const { user } = useAuth();
  const isCreator = user?.role === 'creator';

  return isCreator ? <CreatorAccountCenter /> : <BrandAccountCenter />;
}

/* ═══════════════════════════ creator account centre ══════════════════════════ */

function CreatorAccountCenter() {
  const [params, setParams] = useSearchParams();
  const reduced = usePrefersReducedMotion();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  // The live commission rate, for the rate card's take-home figures. A failure
  // is not worth an error state — the rate card falls back to the published
  // 12.5% and says so.
  const [commissionPct, setCommissionPct] = useState(null);

  const requested = params.get('section');
  const active = SECTIONS.some((s) => s.id === requested) ? requested : 'overview';

  /**
   * Load the profile.
   *
   * `profile` stays null until this succeeds, and no section renders without
   * it. That is deliberate and load-bearing: the version this replaces caught
   * the error, left the form bound to `{}`, rendered every field empty and then
   * let "Save changes" write those blanks over a real profile. A failed load
   * must not be able to become a destructive write.
   */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    api.myProfile()
      .then(({ data }) => { if (alive) setProfile(data ?? {}); })
      .catch((e) => { if (alive) setError(e); })
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
  }, [nonce]);

  useEffect(() => {
    let alive = true;
    api.platformStats()
      .then(({ data }) => {
        if (alive && typeof data?.commissionPct === 'number') setCommissionPct(data.commissionPct);
      })
      .catch(() => { /* the rate card has a documented fallback */ });
    return () => { alive = false; };
  }, []);

  const go = useCallback((section) => {
    setParams(section === 'overview' ? {} : { section }, { replace: false });
    // A section change is a navigation, and landing halfway down the new
    // section because the last one was long reads as the page being broken.
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }, [setParams, reduced]);

  /** Every section reports its saved profile back, so the whole page stays in step. */
  const onSaved = useCallback((next) => {
    if (next) setProfile(next);
  }, []);

  /** After a social connect/disconnect the rollups change; re-read the profile. */
  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  const completeness = useMemo(
    () => (profile ? profileCompleteness(profile) : null),
    [profile],
  );

  const current = SECTIONS.find((s) => s.id === active);

  return (
    <AppShell>
      <motion.div
        variants={withReducedMotion(page, reduced)}
        initial="hidden"
        animate="visible"
        className="max-w-[1180px] mx-auto px-4 sm:px-6 py-6 sm:py-8"
      >
        <header className="mb-5 sm:mb-6">
          <h1 className="font-display font-extrabold text-xl sm:text-2xl text-ink">
            Profile &amp; account
          </h1>
          <p className="text-muted text-sm mt-1 max-w-prose leading-relaxed">
            Everything brands see about you, and everything only you can see.
          </p>
        </header>

        {loading ? (
          <div className="lg:flex lg:gap-8">
            <div className="hidden lg:block w-[260px] shrink-0">
              <SkeletonList count={5} label="Loading your profile" />
            </div>
            <div className="flex-1 min-w-0">
              <SkeletonList count={4} label="Loading your profile" />
            </div>
          </div>
        ) : error ? (
          <div className="max-w-2xl">
            <ErrorBlock error={error} onRetry={refetch} />
          </div>
        ) : profile ? (
          <div className="lg:flex lg:gap-8 lg:items-start">
            <ProfileNav
              active={active}
              onSelect={go}
              completeness={completeness ? { ...completeness, onFix: go } : null}
            />

            <div className="flex-1 min-w-0 mt-5 lg:mt-0">
              {/*
                `mode="wait"` so the outgoing section is gone before the next
                arrives. Cross-fading two forms of different heights makes the
                page jump, and these differ a lot — Overview is long, Rate Card
                can be three rows.
              */}
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={active}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
                  transition={{ duration: 0.22, ease: [0.2, 0.7, 0.3, 1] }}
                >
                  <h2 className="sr-only">{current?.label}</h2>

                  {active === 'overview' && <Overview profile={profile} onEdit={go} />}

                  {active === 'personal' && (
                    <PersonalInfo profile={profile} onSaved={onSaved} />
                  )}

                  {active === 'social' && (
                    <SocialMedia profile={profile} onChanged={refetch} />
                  )}

                  {active === 'portfolio' && (
                    <Portfolio profile={profile} onSaved={onSaved} />
                  )}

                  {active === 'preferences' && (
                    <WorkPreferences profile={profile} onSaved={onSaved} />
                  )}

                  {active === 'rates' && (
                    <RateCard profile={profile} onSaved={onSaved} commissionPct={commissionPct} />
                  )}

                  {active === 'bank' && (
                    <BankPayments profile={profile} onSaved={onSaved} />
                  )}

                  {active === 'verification' && <Verification />}

                  {active === 'settings' && (
                    <SettingsSection profile={profile} onProfileChange={setProfile} />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        ) : null}
      </motion.div>
    </AppShell>
  );
}

/* ───────────────────────────────── settings ────────────────────────────────── */

/**
 * Visibility, the media kit, and account deletion.
 *
 * `AccountSettings` is unchanged — it already owns Policy 3.3 visibility and
 * the deletion flow, including the part that refuses while collaborations are
 * in progress. The media kit joins it here because it is the last "about your
 * account as a whole" item, and it had been floating between the rate card and
 * the destructive controls on the old page.
 */
function SettingsSection({ profile, onProfileChange }) {
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();

  async function downloadKit() {
    setDownloading(true);
    try {
      await api.downloadMediaKit(
        `${(profile?.displayName || 'creator').replace(/\s+/g, '-')}-media-kit.pdf`,
      );
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title="Media kit"
        description="A one-page PDF built from your current profile, social stats and rate card — regenerated each time, so it is never out of date."
        actions={
          <button onClick={downloadKit} disabled={downloading} className="btn-brand text-sm justify-center">
            {downloading
              ? 'Building…'
              : <><FileText className="w-4 h-4" /> Download PDF</>}
          </button>
        }
      >
        <div className="grid grid-cols-3 gap-3">
          <QuickLink to="/portfolio" icon={ImageIcon} label="Portfolio" />
          <QuickLink to="/analytics" icon={BarChart} label="Analytics" />
          <QuickLink to="/earnings" icon={Wallet} label="Earnings" />
        </div>
      </SectionCard>

      <AccountSettings
        profile={profile}
        isCreator
        onProfileChange={onProfileChange}
      />
    </div>
  );
}

function QuickLink({ to, icon: Icon, label }) {
  return (
    <Link
      to={to}
      className="card-interactive flex flex-col items-center gap-1.5 p-3 rounded-xl2 text-center focusable"
    >
      <Icon className="w-5 h-5 text-brand-600" />
      <span className="text-xs font-medium text-ink">{label}</span>
    </Link>
  );
}

/* ════════════════════════════ brand account centre ═══════════════════════════ */

/**
 * The Brand Profile and Account Center.
 *
 * Nine sections, and deliberately no Team / Admin Access — the brand profile is
 * about the business and how it collaborates, not about who at the company can
 * sign in. `BrandProfile.teamMembers` still exists on the model and is left
 * alone; it is simply not surfaced here.
 *
 * ── Everything goes through the existing APIs ──────────────────────────────
 *
 *   Business Information   PATCH /api/users/me/brand
 *   Brand Identity         PATCH /api/users/me/brand + the presigned upload endpoint
 *   Social Media           the existing Instagram / Facebook / YouTube OAuth
 *   Previous Work          GET /api/campaigns and GET /api/deals, read-only
 *   Campaign Preferences   PATCH /api/users/me/brand
 *   Payment & Billing      PATCH /api/users/me/brand + GET /api/payments/transactions
 *   Verification           POST and GET /api/verifications
 *   Settings               DELETE /api/users/me
 *
 * No new endpoint was added for any of it. The backend changes were additive
 * fields on `BrandProfile`, a projection that stops creators reading a brand's
 * private business data, and making the social mirror resolve a brand profile
 * as well as a creator one.
 *
 * ── Settings has no visibility toggle ──────────────────────────────────────
 *
 * `setProfileVisibility` is creator-only and `BrandProfile` has no
 * `isPublished` field, so a toggle here would be a control with nothing behind
 * it. `AccountSettings` already gates that block on `isCreator`, so it renders
 * deletion alone — which is the real, working functionality.
 */
function BrandAccountCenter() {
  const [params, setParams] = useSearchParams();
  const reduced = usePrefersReducedMotion();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  const requested = params.get('section');
  const active = BRAND_SECTIONS.some((s) => s.id === requested) ? requested : 'overview';

  /**
   * Load the profile.
   *
   * `profile` stays null until this succeeds and no section renders without it,
   * for the same reason as the creator centre: the page this replaces caught
   * the load error, left the form bound to `{}` and let "Save changes" write
   * those blanks over a real profile.
   */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    api.myProfile()
      .then(({ data }) => { if (alive) setProfile(data ?? {}); })
      .catch((e) => { if (alive) setError(e); })
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
  }, [nonce]);

  const go = useCallback((section) => {
    setParams(section === 'overview' ? {} : { section }, { replace: false });
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }, [setParams, reduced]);

  /**
   * A section saved.
   *
   * `PATCH /me/brand` returns the updated document but NOT the derived
   * `verificationLevel`, which only `GET /me/profile` computes. Carrying the
   * existing one forward keeps the badge and the outstanding-requirements list
   * from vanishing after an unrelated save; `refetch` is what recomputes it.
   */
  const onSaved = useCallback((next) => {
    if (!next) return;
    setProfile((prev) => ({
      verificationLevel: prev?.verificationLevel,
      ...next,
    }));
  }, []);

  /**
   * Re-read the profile from the server.
   *
   * Used after anything that changes derived state: a social connect or
   * disconnect (which rewrites `socialAccounts`), and after a verification
   * submission or a business-detail change that could move the Policy 13.1
   * level.
   */
  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  const completeness = useMemo(
    () => (profile ? brandCompleteness(profile) : null),
    [profile],
  );

  const current = BRAND_SECTIONS.find((s) => s.id === active);

  return (
    <AppShell>
      <motion.div
        variants={withReducedMotion(page, reduced)}
        initial="hidden"
        animate="visible"
        className="max-w-[1180px] mx-auto px-4 sm:px-6 py-6 sm:py-8"
      >
        <header className="mb-5 sm:mb-6">
          <h1 className="font-display font-extrabold text-xl sm:text-2xl text-ink">
            Brand &amp; account
          </h1>
          <p className="text-muted text-sm mt-1 max-w-prose leading-relaxed">
            Everything creators see about your brand, and everything only you can see.
          </p>
        </header>

        {loading ? (
          <div className="lg:flex lg:gap-8">
            <div className="hidden lg:block w-[260px] shrink-0">
              <SkeletonList count={5} label="Loading your brand profile" />
            </div>
            <div className="flex-1 min-w-0">
              <SkeletonList count={4} label="Loading your brand profile" />
            </div>
          </div>
        ) : error ? (
          <div className="max-w-2xl">
            <ErrorBlock error={error} onRetry={refetch} />
          </div>
        ) : profile ? (
          <div className="lg:flex lg:gap-8 lg:items-start">
            <ProfileNav
              active={active}
              onSelect={go}
              sections={BRAND_SECTIONS}
              completeness={completeness ? { ...completeness, onFix: go } : null}
            />

            <div className="flex-1 min-w-0 mt-5 lg:mt-0">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={active}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
                  transition={{ duration: 0.22, ease: [0.2, 0.7, 0.3, 1] }}
                >
                  <h2 className="sr-only">{current?.label}</h2>

                  {active === 'overview' && <BrandOverview profile={profile} onEdit={go} />}

                  {active === 'business' && (
                    // A business change can move the verification level, so the
                    // save is followed by a re-read rather than a local merge.
                    <BusinessInformation
                      profile={profile}
                      onSaved={(next) => { onSaved(next); refetch(); }}
                    />
                  )}

                  {active === 'identity' && (
                    <BrandIdentity profile={profile} onSaved={onSaved} />
                  )}

                  {active === 'social' && <BrandSocial onChanged={refetch} />}

                  {active === 'work' && <PreviousWork profile={profile} />}

                  {active === 'preferences' && (
                    <CampaignPreferences profile={profile} onSaved={onSaved} />
                  )}

                  {active === 'billing' && (
                    <PaymentBilling
                      profile={profile}
                      onSaved={(next) => { onSaved(next); refetch(); }}
                    />
                  )}

                  {active === 'verification' && (
                    <BrandVerification profile={profile} onEdit={go} />
                  )}

                  {active === 'settings' && (
                    <BrandSettings profile={profile} onProfileChange={setProfile} />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        ) : null}
      </motion.div>
    </AppShell>
  );
}

/**
 * Brand settings.
 *
 * Account deletion, through the existing flow — including the part that refuses
 * while collaborations are in progress, so a creator is never left with a deal
 * against a closed account.
 *
 * No visibility toggle: see the note on `BrandAccountCenter`.
 */
function BrandSettings({ profile, onProfileChange }) {
  return (
    <div className="space-y-5">
      <SectionCard
        title="Your campaigns and collaborations"
        description="Account settings live here; the day-to-day work has its own screens."
      >
        <div className="grid grid-cols-3 gap-3">
          <QuickLink to="/campaigns" icon={FileText} label="Campaigns" />
          <QuickLink to="/creators" icon={ImageIcon} label="Find creators" />
          <QuickLink to="/deals" icon={BarChart} label="Deals" />
        </div>
      </SectionCard>

      <AccountSettings
        profile={profile}
        isCreator={false}
        onProfileChange={onProfileChange}
      />
    </div>
  );
}