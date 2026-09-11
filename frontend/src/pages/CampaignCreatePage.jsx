import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import AppShell from '../components/AppShell';
import { StepRail, DraftNotice } from '../components/campaign/wizard';
import Basics from '../components/campaign/steps/Basics';
import Content from '../components/campaign/steps/Content';
import Creators from '../components/campaign/steps/Creators';
import Budget from '../components/campaign/steps/Budget';
import Timeline from '../components/campaign/steps/Timeline';
import Usage from '../components/campaign/steps/Usage';
import Extras from '../components/campaign/steps/Extras';
import Review from '../components/campaign/steps/Review';
import { Check, ChevDown, Send } from '../components/icons';
import { StatusPill } from '../components/feedback';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorBlock, Spinner, useToast } from '../lib/ui-state';
import { page, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';

/**
 * The campaign creation wizard.
 *
 * ── Why a draft exists from the first save ─────────────────────────────────
 *
 * The wizard creates a real `draft` campaign as soon as there is a title, and
 * everything after that is a PATCH to it. The alternative — holding eight
 * sections in React state and saving once at the end — loses the whole brief to
 * a closed tab, and a campaign brief is twenty minutes of work.
 *
 * That also makes autosave possible at all: `PATCH /api/campaigns/:id` already
 * existed and already refuses to edit a live campaign, so autosave is a debounce
 * around an endpoint with the right rules, not a new write path.
 *
 * ── Autosave, and what it does not do ──────────────────────────────────────
 *
 * A save fires 1.2 seconds after the last edit. It never fires while another is
 * in flight; a save that fails leaves the local state alone and says so, so the
 * brand can keep typing and retry rather than losing a section to a dropped
 * connection. Autosave is suspended entirely once the campaign leaves `draft` —
 * a campaign in review or live is not editable, and the server would refuse
 * every keystroke.
 *
 * ── "Publish" means submit for review ──────────────────────────────────────
 *
 * Marqueiver reviews every campaign before creators see it — that is existing
 * platform behaviour and predates this wizard. So the final action sends the
 * campaign into the review queue (`draft` → `pending_review`), and the wizard
 * says exactly that rather than implying it goes live on the press of a button.
 * `status` here is the existing five-state lifecycle; `draft` and everything
 * downstream of publishing are the two the brand acts on.
 */

const STEPS = [
  { id: 'basics', label: 'Basic information', blurb: 'Name, category, images', Component: Basics },
  { id: 'content', label: 'Platform & content', blurb: 'Deliverables and guidelines', Component: Content },
  { id: 'creators', label: 'Creator requirements', blurb: 'Who can apply', Component: Creators },
  { id: 'budget', label: 'Budget & commercials', blurb: 'Fee, product, travel', Component: Budget },
  { id: 'timeline', label: 'Timeline', blurb: 'Dates and deadlines', Component: Timeline },
  { id: 'usage', label: 'Usage rights', blurb: 'Duration and exclusivity', Component: Usage },
  { id: 'extras', label: 'Additional requirements', blurb: 'Instructions and questions', Component: Extras },
  { id: 'review', label: 'Review & publish', blurb: 'Check it, then send it', Component: Review },
];

const AUTOSAVE_MS = 1200;

/** The fields a brand-new campaign starts with, so no input is uncontrolled. */
const EMPTY = {
  title: '', brief: '', category: '', objective: '', location: 'India',
  images: [], tags: [], platforms: [], deliverables: [],
  guidelines: { dos: [], donts: [], hashtags: [], mentions: [], cta: '', notes: '' },
  creatorRequirements: { categories: [], locations: [], genders: [], languages: [], audience: {} },
  budget: 0,
  commercials: { creatorCount: 1, paymentModel: 'fixed', product: {}, travel: {}, performanceBonus: {} },
  deadline: null,
  schedule: {},
  usageRights: { channels: [], paidAds: {}, exclusivity: {} },
  extras: { specialInstructions: '', questions: [] },
};

export default function CampaignCreatePage() {
  const { id: routeId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const reduced = usePrefersReducedMotion();

  const [campaign, setCampaign] = useState(routeId ? null : EMPTY);
  const [id, setId] = useState(routeId ?? null);
  const [loadError, setLoadError] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [saveState, setSaveState] = useState('idle');   // idle | saving | saved | error
  const [saveError, setSaveError] = useState(null);
  const [publishing, setPublishing] = useState(false);

  const step = params.get('step') ?? 'basics';
  const index = Math.max(0, STEPS.findIndex((s) => s.id === step));
  const current = STEPS[index] ?? STEPS[0];

  /** A pending save, and whether one is already in flight. */
  const timer = useRef(null);
  const inFlight = useRef(false);
  const pending = useRef(null);

  const editable = !campaign?.status || campaign.status === 'draft' || campaign.status === 'rejected';

  /* ── load an existing draft ── */
  useEffect(() => {
    if (!routeId) return undefined;
    let alive = true;
    api.getCampaign(routeId)
      .then(({ data }) => {
        if (!alive) return;
        // Merged onto EMPTY so a campaign saved before a field existed still
        // renders controlled inputs rather than flipping to uncontrolled.
        setCampaign({ ...EMPTY, ...data, guidelines: { ...EMPTY.guidelines, ...(data.guidelines ?? {}) } });
      })
      .catch((e) => { if (alive) setLoadError(e); });
    return () => { alive = false; };
  }, [routeId]);

  /* ── the readiness checklist, refreshed when the campaign changes ── */
  const refreshReadiness = useCallback(async (campaignId) => {
    if (!campaignId) return;
    try {
      const { data } = await api.campaignReadiness(campaignId);
      setReadiness(data);
    } catch {
      // A failed checklist is not worth interrupting the brand over — the
      // publish gate is the server's anyway, and it will say what is missing.
      setReadiness(null);
    }
  }, []);

  /* ── the save itself ── */
  const save = useCallback(async (next) => {
    if (inFlight.current) { pending.current = next; return; }
    if (!next.title || next.title.trim().length < 3) {
      // Nothing to create yet: the API needs a title, and a campaign called ""
      // in the brand's list is worse than no campaign at all.
      setSaveState('idle');
      return;
    }

    inFlight.current = true;
    setSaveState('saving');
    setSaveError(null);

    try {
      const payload = toPayload(next);
      let savedId = id;

      if (id) {
        const { data } = await api.updateCampaign(id, payload);
        setCampaign((cur) => ({ ...cur, status: data.status }));
      } else {
        const { data } = await api.createCampaign({ ...payload, submit: false });
        savedId = data._id;
        setId(savedId);
        setCampaign((cur) => ({ ...cur, status: data.status }));
        // The URL becomes the draft's, so a reload resumes rather than
        // starting a second empty campaign.
        navigate(`/campaigns/${savedId}/edit?step=${step}`, { replace: true });
      }

      setSaveState('saved');
      // `savedId`, not `id` — on the very first save `id` is still null in this
      // closure, and the checklist would silently never load.
      refreshReadiness(savedId);
    } catch (e) {
      setSaveState('error');
      setSaveError(e);
    } finally {
      inFlight.current = false;
      const queued = pending.current;
      pending.current = null;
      if (queued) save(queued);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, step, navigate, refreshReadiness]);

  /* ── edits schedule a save ── */
  const patch = useCallback((changes) => {
    setCampaign((cur) => {
      const next = { ...cur, ...changes };
      if (editable) {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => save(next), AUTOSAVE_MS);
      }
      return next;
    });
  }, [save, editable]);

  // A pending save must not be dropped when the wizard unmounts.
  useEffect(() => () => clearTimeout(timer.current), []);

  // The review step is the one place a stale checklist would mislead, so it is
  // refreshed on arrival rather than only after a save.
  useEffect(() => {
    if (step === 'review' && id) refreshReadiness(id);
  }, [step, id, refreshReadiness]);

  const goTo = (next) => {
    clearTimeout(timer.current);
    if (editable && campaign?.title?.trim().length >= 3) save(campaign);
    setParams({ step: next }, { replace: false });
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  };

  async function saveDraftNow() {
    clearTimeout(timer.current);
    if (!campaign?.title || campaign.title.trim().length < 3) {
      toast.push('Give the campaign a name first — at least three characters.', 'error');
      setParams({ step: 'basics' });
      return;
    }
    await save(campaign);
    if (!inFlight.current) toast.push('Draft saved', 'success');
  }

  async function publish() {
    clearTimeout(timer.current);
    setPublishing(true);
    try {
      // Save first: publishing a campaign whose last edit never landed would
      // send the reviewer a version the brand never saw.
      await save(campaign);
      if (!id) throw new Error('The draft has not been saved yet.');

      const { data } = await api.submitCampaignForReview(id);
      setCampaign((cur) => ({ ...cur, status: data.status }));
      toast.push('Sent to Marqueiver for review', 'success');
      navigate('/campaigns');
    } catch (e) {
      // The server answers a refusal with the same checklist the review step
      // shows, so the brand is told what is missing rather than just "no".
      const blocking = e?.detail?.details?.blocking;
      if (blocking?.length) {
        setReadiness((cur) => ({ ...(cur ?? {}), ready: false, blocking, sections: e.detail.details.sections ?? cur?.sections ?? [] }));
        setParams({ step: 'review' });
      }
      toast.push(e.message, 'error');
    } finally {
      setPublishing(false);
    }
  }

  if (user && user.role !== 'brand') {
    return (
      <AppShell>
        <div className="max-w-[600px] mx-auto px-4 py-16 text-center">
          <h1 className="font-display font-extrabold text-2xl text-ink">Campaigns are created by brands</h1>
          <p className="text-sm text-muted mt-2">
            Your account is a creator account. Browse open campaigns instead.
          </p>
          <Link to="/campaigns" className="btn-brand mt-6 inline-flex">Browse campaigns</Link>
        </div>
      </AppShell>
    );
  }

  if (loadError) {
    return (
      <AppShell>
        <div className="max-w-[720px] mx-auto px-4 py-10">
          <ErrorBlock error={loadError} onRetry={() => window.location.reload()} />
        </div>
      </AppShell>
    );
  }

  if (!campaign) {
    return (
      <AppShell>
        <div className="max-w-[720px] mx-auto px-4 py-16 text-center text-muted">
          <Spinner className="w-6 h-6 mx-auto" />
          <p className="text-sm mt-3">Opening your draft…</p>
        </div>
      </AppShell>
    );
  }

  const StepComponent = current.Component;
  const first = index === 0;
  const last = index === STEPS.length - 1;

  return (
    <AppShell>
      <motion.div
        variants={withReducedMotion(page, reduced)}
        initial="hidden"
        animate="visible"
        className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6 sm:py-8"
      >
        <header className="mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-ink">
                {routeId ? 'Edit campaign' : 'New campaign'}
              </h1>
              <p className="text-sm text-muted mt-1.5 leading-relaxed max-w-xl">
                Eight sections. Your work saves as you go, and nothing is visible to creators until
                Marqueiver approves it.
              </p>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              {campaign.status && <StatusPill status={campaign.status} />}
              <SaveIndicator state={saveState} />
            </div>
          </div>

          {!editable && (
            <div className="mt-4">
              <DraftNotice>
                This campaign is {campaign.status === 'pending_review' ? 'waiting for review' : campaign.status}
                {' '}and can no longer be edited — creators apply against what they were shown. To change
                it, close it and create a new one.
              </DraftNotice>
            </div>
          )}

          {saveState === 'error' && saveError && (
            <div className="mt-4 rounded-xl2 border border-rose-100 bg-rose-50/70 p-4">
              <p className="text-sm font-semibold text-rose-700">That last change did not save</p>
              <p className="text-xs text-rose-700 mt-1 leading-relaxed">{saveError.message}</p>
              <button onClick={() => save(campaign)} className="btn-outline text-xs mt-3">Try again</button>
            </div>
          )}
        </header>

        <div className="flex flex-col lg:flex-row gap-6">
          <StepRail steps={STEPS} active={current.id} onSelect={goTo} readiness={readiness} />

          <div className="min-w-0 flex-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={current.id}
                initial={reduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: [0.2, 0.7, 0.3, 1] }}
              >
                <fieldset disabled={!editable} className="contents">
                  <StepComponent
                    value={campaign}
                    patch={patch}
                    readiness={readiness}
                    onJump={goTo}
                  />
                </fieldset>
              </motion.div>
            </AnimatePresence>

            {/* ── back / next / publish ── */}
            <div className="sticky bottom-0 mt-6 -mx-4 sm:-mx-0 px-4 sm:px-0 pb-4 pt-4
                            bg-gradient-to-t from-bg via-bg to-transparent"
            >
              <div className="rounded-xl2 border border-line bg-white shadow-lifted p-3
                              flex flex-wrap items-center gap-2.5"
              >
                <button
                  onClick={() => goTo(STEPS[index - 1].id)}
                  disabled={first}
                  className="btn-ghost text-sm disabled:opacity-40"
                >
                  <ChevDown className="w-4 h-4 rotate-90" /> Back
                </button>

                <span className="text-xs text-muted tnum hidden sm:block">
                  Step {index + 1} of {STEPS.length}
                </span>

                <div className="flex items-center gap-2.5 ml-auto">
                  {editable && (
                    <button onClick={saveDraftNow} className="btn-outline text-sm">
                      Save draft
                    </button>
                  )}

                  {last ? (
                    <button
                      onClick={publish}
                      disabled={publishing || !editable || (readiness ? !readiness.ready : false)}
                      className="btn-cta text-sm disabled:opacity-40"
                    >
                      {publishing ? <Spinner className="w-4 h-4" /> : <><Send className="w-4 h-4" /> Publish</>}
                    </button>
                  ) : (
                    <button onClick={() => goTo(STEPS[index + 1].id)} className="btn-brand text-sm">
                      Next <ChevDown className="w-4 h-4 -rotate-90" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </AppShell>
  );
}

/**
 * What the wizard sends.
 *
 * Only the fields the API accepts: `updateCampaignSchema` is `.strict()`, so a
 * stray `_id` or `applicants` read back from a loaded draft would fail the
 * whole save with a validation error about a field the brand never touched.
 */
function toPayload(c) {
  return {
    title: c.title?.trim(),
    brief: c.brief ?? '',
    category: c.category ?? '',
    objective: c.objective ?? '',
    location: c.location || 'India',
    images: c.images ?? [],
    tags: c.tags ?? [],
    platforms: c.platforms ?? [],
    deliverables: (c.deliverables ?? []).map((d) => ({
      platform: d.platform,
      contentType: d.contentType,
      quantity: Number(d.quantity) || 1,
      durationSeconds: d.durationSeconds ?? null,
      format: d.format ?? '',
      notes: d.notes ?? '',
    })),
    guidelines: c.guidelines ?? {},
    creatorRequirements: c.creatorRequirements ?? {},
    budget: Number(c.budget) || 0,
    commercials: c.commercials ?? {},
    deadline: c.deadline ? String(c.deadline).slice(0, 10) : null,
    schedule: normaliseDates(c.schedule ?? {}),
    usageRights: c.usageRights ?? {},
    extras: c.extras ?? {},
  };
}

/** Dates go out as `YYYY-MM-DD`; a loaded draft returns them as ISO timestamps. */
function normaliseDates(schedule) {
  const out = { ...schedule };
  for (const k of ['campaignStart', 'applicationDeadline', 'selectionDeadline', 'collaborationStart', 'campaignEnd']) {
    out[k] = schedule[k] ? String(schedule[k]).slice(0, 10) : null;
  }
  return out;
}

/** Quiet, and never in the way — autosave should be noticed, not announced. */
function SaveIndicator({ state }) {
  if (state === 'idle') return null;

  const map = {
    saving: { text: 'Saving…', className: 'text-muted' },
    saved: { text: 'Saved', className: 'text-jade-700' },
    error: { text: 'Not saved', className: 'text-rose-600' },
  };
  const s = map[state];

  return (
    <span className={`text-xs font-medium inline-flex items-center gap-1.5 ${s.className}`} aria-live="polite">
      {state === 'saving' && <Spinner className="w-3.5 h-3.5" />}
      {state === 'saved' && <Check className="w-3.5 h-3.5" />}
      {s.text}
    </span>
  );
}