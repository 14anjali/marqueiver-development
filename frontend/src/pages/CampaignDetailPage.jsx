import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AppPage from '../components/AppPage';
import CampaignBrief from '../components/campaign/CampaignBrief';
import ApplicationForm from '../components/campaign/ApplicationForm';
import ApplicationStatus from '../components/campaign/ApplicationStatus';
import { StatusPill } from '../components/feedback';
import { Check, X, ShieldCheck, ChevDown } from '../components/icons';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/ui-state';

/**
 * One campaign, in full, for the creator deciding whether to apply.
 *
 * ── Eligibility before effort ──────────────────────────────────────────────
 *
 * Applying is an hour of someone's evening. The panel at the top answers "can I
 * apply, and if not, what is missing" before they scroll — and it answers it
 * from the server, which compared the campaign's requirements against their real
 * profile: connected-account follower totals, categories, verified state. The
 * browser is not in a position to compute that honestly.
 *
 * Every unmet check is advisory. `applyToCampaign` on the server is unchanged
 * and still accepts an application from a creator who misses one, because the
 * brand decides who it works with — a creator at 19,000 against a 20,000 floor
 * may be exactly who they want. So a missed check explains and links to the
 * screen that fixes it; it does not lock the button.
 *
 * ── Three states, one page ─────────────────────────────────────────────────
 *
 * Not applied → the eligibility panel and an Apply button. Applying → the form,
 * in place rather than in a modal, because it is long enough that a creator
 * will want to scroll back into the brief while writing it. Applied → the
 * status tracker, with what they sent and where it has got to.
 *
 * Negotiation is deliberately absent. A selected application links to its deal
 * and stops there; pricing and terms are settled in that flow, not this one.
 */

/** Where a creator goes to fix each kind of unmet requirement. */
const FIX_LINK = {
  personal: { to: '/profile?section=personal', label: 'Update your profile' },
  social: { to: '/profile?section=social', label: 'Connect an account' },
  verification: { to: '/verifications', label: 'Get verified' },
};

export default function CampaignDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();

  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const isBrand = user?.role === 'brand';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.getCampaign(id);
      setCampaign(data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  /** The form posts the application itself and hands back what was stored. */
  function onSubmitted(application) {
    setCampaign((c) => ({ ...c, myApplication: application }));
    setFormOpen(false);
    toast.push('Application sent', 'success');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function withdraw() {
    setWithdrawing(true);
    try {
      const { data } = await api.withdrawApplication(id);
      setCampaign((c) => ({ ...c, myApplication: data.application }));
      toast.push('Application withdrawn', 'success');
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setWithdrawing(false);
    }
  }

  const c = campaign ?? {};
  // Not named `window` — shadowing the global in a React component is the kind
  // of thing that works until someone adds a `window.scrollTo` below it.
  const appWindow = c.applicationWindow ?? {};
  const eligibility = c.eligibility ?? null;
  const applied = Boolean(c.myApplication);

  return (
    <AppPage
      title={c.title || 'Campaign'}
      description={c.brandSummary?.companyName
        ? `From ${c.brandSummary.companyName}`
        : 'Campaign details'}
      loading={loading}
      error={error}
      onRetry={load}
      actions={(
        <Link to="/campaigns" className="btn-ghost text-sm">
          <ChevDown className="w-4 h-4 rotate-90" /> All campaigns
        </Link>
      )}
      width="max-w-[880px]"
    >
      <div className="space-y-5">
        {/* ── applied: where it stands ── */}
        {!isBrand && applied && (
          <ApplicationStatus
            application={c.myApplication}
            campaign={c}
            onWithdraw={withdraw}
            withdrawing={withdrawing}
          />
        )}

        {/* ── not applied: can I, and then the form ── */}
        {!isBrand && !applied && !formOpen && (
          <ApplyPanel
            window={appWindow}
            eligibility={eligibility}
            onApply={() => setFormOpen(true)}
          />
        )}

        {!isBrand && !applied && formOpen && (
          <ApplicationForm
            campaign={c}
            onSubmitted={onSubmitted}
            onCancel={() => setFormOpen(false)}
          />
        )}

        {isBrand && c.status && (
          <div className="rounded-xl3 border border-line bg-white shadow-flat p-4 flex flex-wrap items-center gap-3">
            <StatusPill status={c.status} />
            <p className="text-sm text-muted">
              This is your own campaign, shown the way a creator sees it.
            </p>
            <Link to={`/campaigns/${id}/edit`} className="btn-outline text-sm ml-auto">
              Open in the editor
            </Link>
          </div>
        )}

        <CampaignBrief campaign={c} brand={c.brandSummary} />
      </div>
    </AppPage>
  );
}

/**
 * The decision panel, shown before a creator applies.
 *
 * It answers one question — should I spend an hour on this — and then gets out
 * of the way: once the form is open or the application is sent, the page shows
 * those instead.
 */
function ApplyPanel({ window: appWindow, eligibility, onApply }) {
  const closed = appWindow.open === false;

  return (
    <section className="rounded-xl3 border border-line bg-white shadow-flat overflow-hidden">
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display font-bold text-lg text-ink">
              {closed ? 'Applications are closed' : 'Can you apply?'}
            </h2>
            <p className="text-sm text-muted mt-1 leading-relaxed max-w-prose">
              {closed
                ? appWindow.closedByDeadline
                  ? 'The application deadline for this campaign has passed.'
                  : 'This campaign is no longer accepting applications.'
                : 'These are the brand\u2019s requirements, checked against your profile. They are guidance — the brand decides who it works with.'}
            </p>
          </div>

          <button onClick={onApply} disabled={closed} className="btn-cta shrink-0 disabled:opacity-40">
            Apply now
          </button>
        </div>

        {!closed && eligibility?.evaluated && eligibility.total > 0 && (
          <div className="mt-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">How you match</p>
              <p className="text-xs text-muted tnum">{eligibility.met} of {eligibility.total}</p>
            </div>

            <ul className="mt-3 space-y-2">
              {eligibility.checks.map((check) => <EligibilityRow key={check.id} check={check} />)}
            </ul>

            {!eligibility.eligible && (
              <p className="text-xs text-muted mt-3.5 leading-relaxed">
                You can still apply. Brands see the same list, so it is worth saying in your
                pitch why you are a fit anyway.
              </p>
            )}
          </div>
        )}

        {eligibility && !eligibility.evaluated && (
          <p className="text-sm text-muted mt-4 rounded-xl2 border border-dashed border-line bg-bg/60 px-4 py-4">
            {eligibility.note}{' '}
            <Link to="/profile" className="text-brand-700 font-semibold">Open your profile →</Link>
          </p>
        )}
      </div>
    </section>
  );
}

function EligibilityRow({ check }) {
  const fix = check.ok !== true && check.fix ? FIX_LINK[check.fix] : null;

  // `ok === null` means we could not tell — a missing date of birth, say. That
  // is not a failure the creator caused, so it is not painted as one.
  const tone = check.ok === true ? 'jade' : check.ok === null ? 'muted' : 'rose';

  return (
    <li className="flex items-start gap-2.5">
      <span
        className={`w-5 h-5 rounded-md grid place-items-center shrink-0 mt-0.5 ${
          tone === 'jade' ? 'bg-jade-100 text-jade-700'
            : tone === 'rose' ? 'bg-rose-100 text-rose-600'
              : 'bg-bg text-muted'}`}
      >
        {check.ok === true ? <Check className="w-3 h-3" />
          : check.ok === null ? <ShieldCheck className="w-3 h-3" />
            : <X className="w-3 h-3" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${check.ok === true ? 'text-ink' : 'text-ink font-medium'}`}>
          {check.label}
        </span>
        {check.detail && (
          <span className="block text-xs text-muted mt-0.5 leading-relaxed">{check.detail}</span>
        )}
        {fix && (
          <Link to={fix.to} className="inline-block text-xs font-semibold text-brand-700 mt-1 focusable">
            {fix.label} →
          </Link>
        )}
      </span>
    </li>
  );
}