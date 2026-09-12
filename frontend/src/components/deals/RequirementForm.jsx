import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Drawer } from '../overlay';
import { Money } from '../feedback';
import { NumberField, DateField, SelectField, SubGroup } from '../campaign/wizard';
import { Spinner } from '../../lib/ui-state';
import { api } from '../../lib/api';
import { CONTENT_TYPES, USAGE_CHANNELS } from '../campaign/vocab';

/**
 * The requirement a brand sends a creator it found in discovery.
 *
 * ── Why this is a form and not a confirm button ────────────────────────────
 *
 * What it replaces sent a generated title, the creator's cheapest rate-card
 * line as the fee, and the literal string "To be agreed during negotiation" as
 * the brief. So every direct request arrived identical and described no work at
 * all, and the creator's only honest answer was to ask what it was for. A
 * creator is being asked to commit to something — they have to be able to read
 * what.
 *
 * ── It is the same brief vocabulary as a campaign ──────────────────────────
 *
 * Content types and usage channels come from `campaign/vocab`, the list the
 * campaign wizard uses. A brand should not have to describe the same work in
 * two vocabularies depending on which route it took to the creator.
 *
 * ── What this does NOT do ──────────────────────────────────────────────────
 *
 * It does not negotiate. The deal it creates opens in `invitation`, and under
 * the cleared rules §3 an invitation is explicitly not the first offer — the
 * creator has to accept before either side can post terms. The amount here is
 * an opening position, and the copy says so, because a number in a box reads
 * like a decision unless it is labelled as a starting point.
 */

/** Matches INCLUDED_REVISIONS on the server. */
const DEFAULT_REVISIONS = 3;

const LICENCES = [
  { value: 'default', label: 'Standard — organic social, 12 months' },
  { value: 'extended', label: 'Extended — includes paid usage' },
  { value: 'full_assignment', label: 'Full assignment — all rights transfer' },
];

/** Every content type the brief vocabulary knows, deduplicated across platforms. */
const ALL_CONTENT_TYPES = [...new Set(Object.values(CONTENT_TYPES).flat())];

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function RequirementForm({ open, onClose, creator, onSent }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [campaigns, setCampaigns] = useState([]);

  const suggestedRate = creator?.rateCard?.[0]?.price ?? null;

  // Reset on each open, so a dismissed draft never leaks into the next creator.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm({
      title: '',
      contentTypes: creator?.contentTypes?.length
        ? creator.contentTypes.filter((t) => ALL_CONTENT_TYPES.includes(t)).slice(0, 3)
        : [],
      amount: suggestedRate,
      deliverables: '',
      deadline: null,
      revisionsAllowed: DEFAULT_REVISIONS,
      message: '',
      campaignId: '',
      licenceType: 'default',
      durationMonths: 12,
      paidAdvertising: false,
      whitelisting: false,
      exclusivity: '',
    });
  }, [open, creator?._id, suggestedRate]);

  /**
   * The brand's own campaigns, so a direct request can be filed against one.
   * Optional, and failure is silent — this is a convenience, and a brand with
   * no campaigns is the normal case for a purely direct approach.
   */
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api.listCampaigns()
      .then(({ data }) => { if (alive) setCampaigns(data ?? []); })
      .catch(() => { if (alive) setCampaigns([]); });
    return () => { alive = false; };
  }, [open]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const toggleContentType = (t) => setForm((f) => ({
    ...f,
    contentTypes: f.contentTypes.includes(t)
      ? f.contentTypes.filter((x) => x !== t)
      : [...f.contentTypes, t],
  }));

  /**
   * Client-side mirror of `createDealSchema`. Not the authority — the server
   * validates the same things — but a 422 that names `deliverables` is a worse
   * way to learn the brief is too short than the field saying so.
   */
  const issues = useMemo(() => {
    if (!form) return [];
    const out = [];
    if (form.title.trim().length < 3) out.push('Give the collaboration a title.');
    if (form.deliverables.trim().length < 20) {
      out.push('Describe what you need in at least a sentence — this is what the creator is agreeing to.');
    }
    if (form.amount == null || form.amount < 0) out.push('Set an opening amount, even if it is negotiable.');
    if (form.deadline && form.deadline < todayISO()) out.push('The deadline is in the past.');
    return out;
  }, [form]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.createDeal({
        creatorId: creator.user,
        title: form.title.trim(),
        contentTypes: form.contentTypes,
        amount: Number(form.amount) || 0,
        deliverables: form.deliverables.trim(),
        ...(form.deadline ? { deadline: form.deadline } : {}),
        revisionsAllowed: form.revisionsAllowed ?? DEFAULT_REVISIONS,
        ...(form.message.trim() ? { message: form.message.trim() } : {}),
        ...(form.campaignId ? { campaignId: form.campaignId } : {}),
        usageRights: {
          licenceType: form.licenceType,
          durationMonths: form.durationMonths ?? 12,
          paidAdvertising: form.paidAdvertising,
          whitelisting: form.whitelisting,
        },
        ...(form.exclusivity.trim() ? { exclusivity: form.exclusivity.trim() } : {}),
      });
      onSent?.(data);
    } catch (e) {
      // A 409 carries the existing deal — offer to open it rather than
      // repeating an error the brand cannot act on.
      setError(e);
      setBusy(false);
    }
  }

  if (!form) return null;

  // `ApiError.detail` is the server's whole `error` object, so the payload the
  // 409 attached is one level further in.
  const existingDealId = error?.detail?.details?.dealId;

  return (
    /*
      A Drawer, not a Modal. The Modal panel scrolls as one piece, footer
      included, so on a brief this long the Send button sits somewhere below the
      fold with nothing to say it is there. The Drawer keeps its footer pinned
      and scrolls only the body — and below `sm` it is full-screen, which a
      ten-field form needs and a centred sheet does not give.
    */
    <Drawer
      open={open}
      onClose={busy ? undefined : onClose}
      dismissible={!busy}
      title={`Requirement for ${creator?.displayName || 'this creator'}`}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button>
          <button
            onClick={send}
            disabled={busy || issues.length > 0}
            className="btn-cta"
            title={issues.length > 0 ? issues[0] : undefined}
          >
            {busy ? <><Spinner className="w-4 h-4" /> Sending…</> : 'Send requirement'}
          </button>
        </div>
      )}
    >
      <div className="space-y-5">
        <p className="text-sm text-muted leading-relaxed">
          They can accept, decline, or counter. Nothing is charged and no terms are
          binding until you both confirm them.
        </p>

        {error && (
          <div className="rounded-xl2 border border-rose-200 bg-rose-50 p-3.5">
            <p className="text-sm text-rose-800">{error.message}</p>
            {existingDealId && (
              <Link to={`/deals/${existingDealId}`} className="btn-outline text-xs mt-2.5 inline-flex">
                Open that collaboration
              </Link>
            )}
          </div>
        )}

        <SubGroup title="The work">
          <div>
            <label htmlFor="rq-title" className="field-label">Title</label>
            <input
              id="rq-title"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              maxLength={140}
              placeholder="e.g. Monsoon hair care — two reels"
              className="field mt-1.5"
            />
          </div>

          <div>
            <label htmlFor="rq-deliverables" className="field-label">What you need</label>
            <textarea
              id="rq-deliverables"
              value={form.deliverables}
              onChange={(e) => set('deliverables', e.target.value)}
              rows={5}
              maxLength={4000}
              placeholder={'Two Instagram reels, 30–45s each, shot in daylight.\nProduct must appear in use, not just held.\nOne round of edits before posting.'}
              className="field mt-1.5 leading-relaxed"
            />
            <p className="text-xs text-muted mt-1.5">
              {form.deliverables.trim().length < 20
                ? 'At least a sentence — this is the brief the creator accepts or declines.'
                : `${form.deliverables.length} of 4000 characters.`}
            </p>
          </div>

          <div>
            <span className="field-label">Content formats</span>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {ALL_CONTENT_TYPES.map((t) => {
                const on = form.contentTypes.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleContentType(t)}
                    aria-pressed={on}
                    className={`chip transition-colors focusable ${on ? '!bg-brand-600 !text-white' : 'hover:!bg-bg'}`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
        </SubGroup>

        <SubGroup title="Money and timing" hint="An opening position, not a final price — the creator can counter.">
          {/* One column: the drawer is 440px wide, and two number fields side
              by side inside that are narrower than the numbers they hold. */}
          <div className="grid grid-cols-1 gap-4">
            <NumberField
              id="rq-amount"
              label="Opening amount"
              value={form.amount}
              onChange={(v) => set('amount', v)}
              min={0}
              prefix="₹"
              hint={suggestedRate
                ? 'Taken from their rate card.'
                : 'This creator has no rate card, so start wherever is realistic.'}
            />
            <DateField
              id="rq-deadline"
              label="Deliverable deadline"
              value={form.deadline}
              onChange={(v) => set('deadline', v)}
              min={todayISO()}
              hint="Optional — can be settled in negotiation."
            />
          </div>
          <NumberField
            id="rq-revisions"
            label="Included revision rounds"
            value={form.revisionsAllowed}
            onChange={(v) => set('revisionsAllowed', v)}
            min={0}
            max={10}
            hint="Three is the platform standard. Further rounds are paid scope the creator can refuse."
          />
        </SubGroup>

        {/*
          Policy 8 — usage rights are part of scope, so they are agreed before
          the work rather than discovered after it. Defaults match Policy 8.2.
        */}
        <SubGroup title="Usage rights" hint={`Default licence covers ${USAGE_CHANNELS[0].toLowerCase()} and your website, organically.`}>
          <SelectField
            id="rq-licence"
            label="Licence"
            value={form.licenceType}
            onChange={(v) => set('licenceType', v)}
            options={LICENCES}
            placeholder=""
          />
          <NumberField
            id="rq-duration"
            label="Licence duration, months"
            value={form.durationMonths}
            onChange={(v) => set('durationMonths', v)}
            min={1}
            max={120}
          />
          <div className="space-y-2">
            {[
              ['paidAdvertising', 'Use in paid advertising', 'Excluded by default under Policy 8.3.'],
              ['whitelisting', 'Run ads from the creator’s handle', 'Needs their account access — agree it here.'],
            ].map(([key, label, note]) => (
              <label key={key} className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={(e) => set(key, e.target.checked)}
                  className="mt-0.5 focusable"
                />
                <span className="min-w-0">
                  <span className="block text-sm text-ink">{label}</span>
                  <span className="block text-xs text-muted">{note}</span>
                </span>
              </label>
            ))}
          </div>
        </SubGroup>

        <SubGroup title="Anything else" hint="Optional.">
          {campaigns.length > 0 && (
            <SelectField
              id="rq-campaign"
              label="File under a campaign"
              value={form.campaignId}
              onChange={(v) => set('campaignId', v)}
              options={campaigns.map((c) => ({ value: c._id, label: c.title }))}
              placeholder="Not part of a campaign"
              hint="For your own records. The creator is not applying to it."
            />
          )}
          <div>
            <label htmlFor="rq-exclusivity" className="field-label">Exclusivity</label>
            <input
              id="rq-exclusivity"
              value={form.exclusivity}
              onChange={(e) => set('exclusivity', e.target.value)}
              maxLength={500}
              placeholder="e.g. No competing hair care brand for 30 days after posting"
              className="field mt-1.5"
            />
          </div>
          <div>
            <label htmlFor="rq-message" className="field-label">A note to them</label>
            <textarea
              id="rq-message"
              value={form.message}
              onChange={(e) => set('message', e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Why you thought of them for this."
              className="field mt-1.5 leading-relaxed"
            />
          </div>
        </SubGroup>

        {issues.length > 0 && (
          <ul className="rounded-xl2 border border-money-200 bg-money-50 p-3.5 space-y-1">
            {issues.map((i) => <li key={i} className="text-xs text-money-800">{i}</li>)}
          </ul>
        )}

        <p className="text-xs text-muted leading-relaxed">
          This opens a collaboration in the same workflow as a campaign application:
          they accept, you agree terms, escrow is funded, then work starts. Commission is
          deducted from the agreed value at release — it is not added on top.
          {form.amount > 0 && (
            <>
              {' '}At <Money amount={Number(form.amount)} className="text-xs" /> the creator
              sees that figure as the opening offer.
            </>
          )}
        </p>
      </div>
    </Drawer>
  );
}