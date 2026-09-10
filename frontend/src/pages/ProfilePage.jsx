import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import AppPage from '../components/AppPage';
import SocialConnectCard from '../components/SocialConnectCard';
import AccountSettings from '../components/profile/AccountSettings';
import { Platform, Check, FileText, Image, BarChart, Wallet, ShieldCheck, X } from '../components/icons';
import { Money } from '../components/feedback';
import { rise, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Spinner, useToast } from '../lib/ui-state';

/**
 * My profile — what the other side of the marketplace sees.
 *
 * ── What this pass fixed ────────────────────────────────────────────────────
 *
 *  1. **A failed load could silently erase the profile.** The fetch was
 *     `catch { /* offline *\/ }` — the error was swallowed, `loading` went
 *     false, and the page rendered its form bound to `form`, which was still
 *     `{}`. So every field appeared empty. Pressing "Save changes" then sent
 *     `{ displayName: undefined, headline: undefined, bio: undefined }` — or
 *     empty strings, depending on the field — and overwrote a real profile with
 *     nothing. The user's own bio, headline and company details, gone, with no
 *     error ever shown. The load failure is now a real error state with a
 *     retry, and there is no form to submit until the profile has actually
 *     arrived.
 *  2. **Instagram was a hand-written copy of `SocialConnectCard`.** Fifty lines
 *     re-implementing connect, sync, disconnect and an inline confirm, beside
 *     two platforms that used the shared component — so Instagram's disconnect
 *     looked and behaved differently from Facebook's, on the same page. It is a
 *     caller now.
 *  3. **The Instagram disconnect called a method that does not exist.**
 *     `api.disconnectInstagram` — the client only ever exported
 *     `api.instagramDisconnect`. Pressing "Confirm" threw
 *     `api.disconnectInstagram is not a function`, which the surrounding
 *     `catch` turned into a toast reading exactly that, so a creator could
 *     never disconnect Instagram and was shown a stack-trace fragment when they
 *     tried. Every `api.*` reference in the frontend was swept for the same
 *     shape; this was the only one.
 *  4. **`(followers / 1000).toFixed(1) + 'K'` for every count.** 800 followers
 *     read as "0.8K" and 1.2 million read as "1200.0K". Indian numbering, and
 *     small numbers stay whole.
 *  5. **Two page widths in one page.** The profile was `max-w-[800px]` and the
 *     account-settings block below it `max-w-[1000px]`, so the last section was
 *     visibly wider than everything above it.
 *  6. **`text-emerald-500` in three places.** Confirmation is jade throughout
 *     the product; emerald is a near-miss of it.
 *  7. **Labels associated with nothing** — `<label>` without `htmlFor`, inputs
 *     without `id`.
 *  8. **The rate card accepted negative prices**, and its rows did not stack, so
 *     on a phone the select, the price and the remove button shared 300px.
 */

const CONTENT_TYPES = ['reel', 'post', 'story', 'video', 'short', 'ugc', 'blog', 'live'];

/** Indian-format follower counts. Whole numbers below 1,000; never "0.8K". */
const followers = (n) => {
  const v = Number(n) || 0;
  if (v >= 10000000) return `${(v / 10000000).toFixed(1)}Cr`;
  if (v >= 100000) return `${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(v);
};

export default function ProfilePage() {
  const { user } = useAuth();
  const isBrand = user?.role !== 'creator';
  const reduced = usePrefersReducedMotion();
  const toast = useToast();

  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  const [saving, setSaving] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [downloadingKit, setDownloadingKit] = useState(false);

  /**
   * Load the profile.
   *
   * `form` stays null until this succeeds. That is the whole fix for the
   * overwrite: an empty form cannot be submitted if there is no form.
   */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api.myProfile()
      .then(({ data }) => {
        if (!alive) return;
        setProfile(data ?? {});
        setForm(data ?? {});
      })
      .catch((e) => { if (alive) setError(e); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [nonce]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const toggleArrayValue = (key, value) => {
    setForm((f) => {
      const arr = f[key] || [];
      return { ...f, [key]: arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value] };
    });
  };

  const updateRateRow = (i, key, value) => {
    setForm((f) => {
      const rows = [...(f.rateCard || [])];
      rows[i] = { ...rows[i], [key]: value };
      return { ...f, rateCard: rows };
    });
  };
  const addRateRow = () => setForm((f) => ({ ...f, rateCard: [...(f.rateCard || []), { contentType: 'reel', price: 0 }] }));
  const removeRateRow = (i) => setForm((f) => ({ ...f, rateCard: (f.rateCard || []).filter((_, idx) => idx !== i) }));

  async function save() {
    // Belt and braces: the form is not rendered without a loaded profile, but a
    // write that can blank someone's public presence deserves the guard anyway.
    if (!form || !profile) return;
    setSaving(true);
    try {
      const { data } = isBrand
        ? await api.updateBrand({
          companyName: form.companyName,
          industry: form.industry,
          about: form.about,
          website: form.website,
        })
        : await api.updateCreator({
          displayName: form.displayName,
          headline: form.headline,
          bio: form.bio,
        });
      if (data) setProfile(data);
      toast.push('Profile saved', 'success');
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function savePreferences() {
    if (!form) return;
    setSavingPrefs(true);
    try {
      const { data } = await api.updateCreator({
        availability: form.availability,
        collaborationTypes: form.collaborationTypes || [],
        contentTypes: form.contentTypes || [],
        // Guard the rows on the way out too: a price typed and then deleted
        // leaves NaN, which serialises to null and fails validation server-side
        // with a message about a field the user cannot see.
        rateCard: (form.rateCard || [])
          .filter((r) => r.contentType)
          .map((r) => ({ ...r, price: Math.max(0, Number(r.price) || 0) })),
      });
      setProfile(data);
      setForm(data);
      toast.push('Preferences saved', 'success');
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setSavingPrefs(false);
    }
  }

  async function downloadKit() {
    setDownloadingKit(true);
    try {
      await api.downloadMediaKit(`${(profile?.displayName || 'creator').replace(/\s+/g, '-')}-media-kit.pdf`);
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setDownloadingKit(false);
    }
  }

  const rateTotal = useMemo(
    () => (form?.rateCard || []).reduce((sum, r) => sum + (Number(r.price) || 0), 0),
    [form?.rateCard],
  );

  const section = withReducedMotion(rise, reduced);

  return (
    <AppPage
      title="My profile"
      description={`This is what ${isBrand ? 'creators' : 'brands'} see about you.`}
      loading={loading}
      error={error}
      onRetry={() => setNonce((n) => n + 1)}
      skeletonRows={4}
      width="max-w-[860px]"
    >
      {form && (
        <>
          {/* ── who you are ── */}
          <motion.section variants={section} className="card-edge p-5 sm:p-6">
            <div className="space-y-4">
              {isBrand ? (
                <>
                  <Field id="p-company" label="Company name" value={form.companyName || ''} onChange={(v) => set('companyName', v)} />
                  <Field id="p-industry" label="Industry" value={form.industry || ''} onChange={(v) => set('industry', v)} />
                  <Field id="p-website" label="Website" type="url" value={form.website || ''} onChange={(v) => set('website', v)} placeholder="https://" />
                  <Field id="p-about" label="About" textarea value={form.about || ''} onChange={(v) => set('about', v)} />
                </>
              ) : (
                <>
                  <Field id="p-name" label="Display name" value={form.displayName || ''} onChange={(v) => set('displayName', v)} />
                  <Field id="p-headline" label="Headline" value={form.headline || ''} onChange={(v) => set('headline', v)} placeholder="e.g. Fitness & Lifestyle Creator" />
                  <Field id="p-bio" label="Bio" textarea value={form.bio || ''} onChange={(v) => set('bio', v)} />
                </>
              )}
            </div>

            <div className="flex justify-end mt-5">
              <button onClick={save} disabled={saving} className="btn-brand">
                {saving ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Save changes'}
              </button>
            </div>
          </motion.section>

          {/* ── verification ── */}
          <motion.section
            variants={section}
            className="card-edge p-5 sm:p-6 mt-5 flex flex-col sm:flex-row sm:items-center gap-4"
          >
            <span className="w-11 h-11 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-ink">Verification</p>
              <p className="text-sm text-muted leading-relaxed">
                Submit business, GST, or other documents to get a verified badge.
              </p>
            </div>
            <Link to="/verifications" className="btn-outline text-sm shrink-0 justify-center">Manage</Link>
          </motion.section>

          {/* ── availability & preferences (creator only) ── */}
          {!isBrand && (
            <motion.section variants={section} className="card-edge p-5 sm:p-6 mt-5">
              <h2 className="font-display font-bold text-ink mb-4">Availability &amp; preferences</h2>

              <div className="flex items-center justify-between gap-4 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">Available for new campaigns</p>
                  <p className="text-xs text-muted mt-0.5">
                    Turn this off if you are not taking new work right now.
                  </p>
                </div>
                {/*
                  A switch, announced as one. It was a bare `<button>` with no
                  role and no state, so assistive tech read it as an unlabelled
                  button and gave no hint whether it was on.
                */}
                <button
                  role="switch"
                  aria-checked={Boolean(form.availability)}
                  aria-label="Available for new campaigns"
                  onClick={() => set('availability', !form.availability)}
                  className={`w-11 h-6 rounded-full relative transition-colors shrink-0 focusable
                              ${form.availability ? 'bg-jade-500' : 'bg-line'}`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-flat
                                transition-all duration-200 ${form.availability ? 'left-[22px]' : 'left-0.5'}`}
                  />
                </button>
              </div>

              <ChipGroup
                label="Collaboration types"
                options={['paid', 'barter']}
                selected={form.collaborationTypes || []}
                onToggle={(t) => toggleArrayValue('collaborationTypes', t)}
              />

              <ChipGroup
                label="Content types you create"
                options={CONTENT_TYPES}
                selected={form.contentTypes || []}
                onToggle={(t) => toggleArrayValue('contentTypes', t)}
              />

              <div className="py-4 border-t border-line">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <p className="text-sm font-medium text-ink">Rate card</p>
                    {rateTotal > 0 && (
                      <p className="text-xs text-muted mt-0.5">
                        {(form.rateCard || []).length} rate{(form.rateCard || []).length === 1 ? '' : 's'},
                        {' '}from <Money amount={Math.min(...(form.rateCard || []).map((r) => Number(r.price) || 0))} />
                      </p>
                    )}
                  </div>
                  <button onClick={addRateRow} className="text-xs text-brand-600 font-semibold focusable">
                    + Add rate
                  </button>
                </div>

                {!(form.rateCard || []).length ? (
                  <p className="text-xs text-muted">
                    No rates set yet — brands will see &ldquo;Contact for pricing&rdquo;.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {form.rateCard.map((r, i) => (
                      // Stacks below `sm`. Three controls sharing 300px meant a
                      // ₹ field about 70px wide.
                      <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <label className="sr-only" htmlFor={`rate-type-${i}`}>Content type for rate {i + 1}</label>
                        <select
                          id={`rate-type-${i}`}
                          value={r.contentType}
                          onChange={(e) => updateRateRow(i, 'contentType', e.target.value)}
                          className="border border-line rounded-lg px-2.5 py-2 text-sm bg-white capitalize flex-1 focusable"
                        >
                          {CONTENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>

                        <div className="flex items-center gap-2">
                          <label className="sr-only" htmlFor={`rate-price-${i}`}>Price for rate {i + 1}</label>
                          <input
                            id={`rate-price-${i}`}
                            type="number"
                            // A negative rate card is not a thing. The field
                            // accepted one, and the row read "₹-500".
                            min={0}
                            step={100}
                            inputMode="numeric"
                            value={r.price}
                            onChange={(e) => updateRateRow(i, 'price', Math.max(0, Number(e.target.value) || 0))}
                            placeholder="₹"
                            className="w-full sm:w-32 border border-line rounded-lg px-2.5 py-2 text-sm tnum focusable"
                          />
                          <button
                            onClick={() => removeRateRow(i)}
                            aria-label={`Remove rate ${i + 1}`}
                            className="text-muted hover:text-rose-500 p-1.5 shrink-0 focusable transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-3">
                <button onClick={savePreferences} disabled={savingPrefs} className="btn-brand">
                  {savingPrefs ? <><Spinner className="w-4 h-4" /> Saving…</> : 'Save preferences'}
                </button>
              </div>
            </motion.section>
          )}

          {/* ── connected accounts ──
              All three go through the same component. Instagram used to have a
              hand-written copy of it directly in this file. */}
          {!isBrand && (
            <>
              <SocialConnectCard
                platform="instagram" label="Instagram" successParam="ig"
                fetchProfile={api.instagramProfile}
                getAuthUrl={api.instagramAuthUrl}
                sync={api.instagramSync}
                disconnect={api.instagramDisconnect}
                renderConnected={(ig) => (
                  <>
                    <div className="font-semibold text-ink flex items-center gap-1 truncate">
                      @{ig.username} <Check className="w-4 h-4 text-jade-600 shrink-0" />
                    </div>
                    <div className="text-sm text-muted">
                      {followers(ig.followers)} followers · {followers(ig.following)} following
                      {' · '}{ig.mediaCount || 0} posts
                    </div>
                    {ig.lastSyncedAt && (
                      <div className="text-[11px] text-muted mt-0.5">
                        Last synced {new Date(ig.lastSyncedAt).toLocaleString('en-IN')}
                      </div>
                    )}
                  </>
                )}
              />

              <SocialConnectCard
                platform="facebook" label="Facebook" successParam="fb"
                fetchProfile={api.facebookProfile} getAuthUrl={api.facebookAuthUrl} sync={api.facebookSync}
                disconnect={api.disconnectFacebook}
                renderConnected={(fb) => (
                  <>
                    {/* The model field is `name`. `pageName` was never a path on
                        the schema, so this rendered blank on every connected Page. */}
                    <div className="font-semibold text-ink flex items-center gap-1 truncate">
                      {fb.name} <Check className="w-4 h-4 text-jade-600 shrink-0" />
                    </div>
                    {typeof fb.followersCount === 'number' && (
                      <div className="text-sm text-muted">{followers(fb.followersCount)} followers</div>
                    )}
                    {fb.lastSyncedAt && (
                      <div className="text-[11px] text-muted mt-0.5">
                        Last synced {new Date(fb.lastSyncedAt).toLocaleString('en-IN')}
                      </div>
                    )}
                  </>
                )}
              />

              <SocialConnectCard
                platform="youtube" label="YouTube" successParam="yt"
                fetchProfile={api.youtubeProfile} getAuthUrl={api.youtubeAuthUrl} sync={api.youtubeSync}
                disconnect={api.disconnectYoutube}
                renderConnected={(yt) => (
                  <>
                    <div className="font-semibold text-ink flex items-center gap-1 truncate">
                      {yt.title} <Check className="w-4 h-4 text-jade-600 shrink-0" />
                    </div>
                    <div className="text-sm text-muted">
                      {followers(yt.subscriberCount)} subscribers · {yt.videoCount || 0} videos
                    </div>
                    {yt.lastSyncedAt && (
                      <div className="text-[11px] text-muted mt-0.5">
                        Last synced {new Date(yt.lastSyncedAt).toLocaleString('en-IN')}
                      </div>
                    )}
                  </>
                )}
              />
            </>
          )}

          {!isBrand && profile?.socialAccounts?.length > 0 && (
            <motion.section variants={section} className="card-edge p-5 sm:p-6 mt-5">
              <h2 className="font-display font-bold text-ink mb-3">Connected platforms</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {profile.socialAccounts.map((s) => (
                  <div key={s.platform} className="flex items-center gap-2 p-3 rounded-lg border border-line">
                    <Platform name={s.platform} className="w-6 h-6 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink capitalize truncate">{s.platform}</p>
                      {/* Was `(followers/1000).toFixed(1) + 'K'`, so 800 read as
                          "0.8K" and 1.2M read as "1200.0K". */}
                      <p className="text-[11px] text-muted tnum">{followers(s.followers)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.section>
          )}

          {!isBrand && (
            <motion.section variants={section} className="card-edge p-5 sm:p-6 mt-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <h2 className="font-display font-bold text-ink">Media kit</h2>
                <button onClick={downloadKit} disabled={downloadingKit} className="btn-brand text-sm justify-center">
                  {downloadingKit
                    ? <><Spinner className="w-4 h-4" /> Building…</>
                    : <><FileText className="w-4 h-4" /> Download PDF</>}
                </button>
              </div>
              <p className="text-sm text-muted leading-relaxed">
                A one-page PDF built from your current profile, social stats and rate card — always
                up to date.
              </p>
              <div className="grid grid-cols-3 gap-3 mt-4">
                <KitLink to="/portfolio" icon={Image} label="Portfolio" />
                <KitLink to="/analytics" icon={BarChart} label="Analytics" />
                <KitLink to="/earnings" icon={Wallet} label="Earnings" />
              </div>
            </motion.section>
          )}

          {/* Policy 3.3 + account deletion. Placed at the end of the profile so
              destructive controls are never adjacent to routine editing — and
              inside the same width as everything above it, which it was not. */}
          <motion.section variants={section} className="mt-10 pb-4">
            <h2 className="font-display font-extrabold text-lg text-ink mb-4">Account settings</h2>
            <AccountSettings
              profile={profile}
              isCreator={!isBrand}
              onProfileChange={setProfile}
            />
          </motion.section>
        </>
      )}
    </AppPage>
  );
}

/* ─────────────────────────────── pieces ────────────────────────────────────── */

function KitLink({ to, icon: Icon, label }) {
  return (
    <Link
      to={to}
      className="card-interactive flex flex-col items-center gap-1.5 p-3 rounded-lg text-center focusable"
    >
      <Icon className="w-5 h-5 text-brand-600" />
      <span className="text-xs font-medium text-ink">{label}</span>
    </Link>
  );
}

function ChipGroup({ label, options, selected, onToggle }) {
  return (
    <fieldset className="py-4 border-t border-line">
      <legend className="text-sm font-medium text-ink mb-2">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((t) => {
          const on = selected.includes(t);
          return (
            <button
              key={t}
              type="button"
              // `aria-pressed` is the difference between "a row of buttons" and
              // "a set of choices, and these are the ones you have made".
              aria-pressed={on}
              onClick={() => onToggle(t)}
              className={`pill capitalize transition-all duration-200 focusable ${
                on
                  ? 'bg-brand-600 text-white shadow-flat'
                  : 'bg-white text-muted border border-line hover:border-brand-200 hover:text-ink'}`}
            >
              {t}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * A labelled field.
 *
 * The previous local `Field` rendered a `<label>` with no `htmlFor` next to an
 * `<input>` with no `id`, so tapping the label did nothing and a screen reader
 * announced an unnamed textbox.
 */
function Field({ id, label, value, onChange, textarea, placeholder, type = 'text' }) {
  const common = {
    id,
    value,
    placeholder,
    onChange: (e) => onChange(e.target.value),
    className: 'w-full border border-line rounded-lg px-3 py-2.5 text-sm bg-white '
      + 'focus:border-brand-400 transition-colors focusable',
  };

  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <div className="mt-1.5">
        {textarea ? <textarea rows={3} {...common} /> : <input type={type} {...common} />}
      </div>
    </div>
  );
}
