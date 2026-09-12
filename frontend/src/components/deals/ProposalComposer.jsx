import { useEffect, useMemo, useState } from 'react';
import { Drawer } from '../overlay';
import { NumberField, DateField, SelectField, LineListField, SubGroup } from '../campaign/wizard';
import { Spinner } from '../../lib/ui-state';
import { CONTENT_TYPES } from '../campaign/vocab';

/**
 * Writing a proposal, or countering one.
 *
 * ── It always starts from something ────────────────────────────────────────
 *
 * The composer opens pre-filled with the version being answered, so a counter
 * is an edit to a real document rather than a blank form. That is what makes
 * "the money is fine, the usage rights are not" a two-second change instead of
 * a re-typing exercise — and it is why the diff on the resulting version is
 * meaningful: the fields nobody touched genuinely did not move.
 *
 * ── Nothing is overwritten ─────────────────────────────────────────────────
 *
 * Sending produces a new version with the next number. The one being answered
 * stays exactly as it was, still readable in the history, still showing what
 * its author actually proposed.
 */

const LICENCES = [
  { value: 'default', label: 'Standard — organic social' },
  { value: 'extended', label: 'Extended — includes paid usage' },
  { value: 'full_assignment', label: 'Full assignment — all rights transfer' },
];

const ALL_CONTENT_TYPES = [...new Set(Object.values(CONTENT_TYPES).flat())];

const dateInput = (d) => (d ? String(new Date(d).toISOString()).slice(0, 10) : null);
const todayISO = () => new Date().toISOString().slice(0, 10);

/** The composer's shape, from whichever version is being answered. */
function fromTerms(t = {}) {
  return {
    amount: t.amount ?? null,
    deliverables: t.deliverables ?? '',
    contentItems: (t.contentItems ?? []).map((i) => ({
      contentType: i.contentType, quantity: i.quantity ?? 1,
    })),
    dos: t.guidelines?.dos ?? [],
    donts: t.guidelines?.donts ?? [],
    hashtags: (t.guidelines?.hashtags ?? []).join(', '),
    mentions: (t.guidelines?.mentions ?? []).join(', '),
    guidelineNotes: t.guidelines?.notes ?? '',
    startDate: dateInput(t.startDate),
    deadline: dateInput(t.deadline),
    revisionsAllowed: t.revisionsAllowed ?? 3,
    licenceType: t.usageRights?.licenceType ?? 'default',
    durationMonths: t.usageRights?.durationMonths ?? 12,
    paidAdvertising: Boolean(t.usageRights?.paidAdvertising),
    whitelisting: Boolean(t.usageRights?.whitelisting),
    exclusivity: t.exclusivity ?? '',
    otherTerms: t.otherTerms ?? '',
    expiresAt: null,
    note: '',
  };
}

const csv = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

export default function ProposalComposer({ open, onClose, basedOn, nextVersion, onSend, busy }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(fromTerms(basedOn ?? {}));
  }, [open, basedOn]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const toggleType = (t) => setForm((f) => {
    const has = f.contentItems.some((i) => i.contentType === t);
    return {
      ...f,
      contentItems: has
        ? f.contentItems.filter((i) => i.contentType !== t)
        : [...f.contentItems, { contentType: t, quantity: 1 }],
    };
  });

  const setQty = (t, q) => setForm((f) => ({
    ...f,
    contentItems: f.contentItems.map((i) => (i.contentType === t ? { ...i, quantity: q } : i)),
  }));

  const issues = useMemo(() => {
    if (!form) return [];
    const out = [];
    if (form.amount == null || form.amount < 0) out.push('Set an amount.');
    if (!form.contentItems.length && !form.deliverables.trim()) {
      out.push('Say what the work is — pick content formats, or describe it.');
    }
    if (form.contentItems.some((i) => !i.quantity || i.quantity < 1)) {
      out.push('Every content format needs a quantity of at least 1.');
    }
    if (form.startDate && form.deadline && form.startDate > form.deadline) {
      out.push('Work cannot start after the deadline it is due.');
    }
    if (form.expiresAt && form.expiresAt <= todayISO()) {
      out.push('An expiry has to be in the future.');
    }
    return out;
  }, [form]);

  async function send() {
    setError(null);
    try {
      await onSend({
        amount: Number(form.amount) || 0,
        deliverables: form.deliverables.trim(),
        contentItems: form.contentItems,
        guidelines: {
          dos: form.dos,
          donts: form.donts,
          hashtags: csv(form.hashtags),
          mentions: csv(form.mentions),
          ...(form.guidelineNotes.trim() ? { notes: form.guidelineNotes.trim() } : {}),
        },
        ...(form.startDate ? { startDate: form.startDate } : {}),
        ...(form.deadline ? { deadline: form.deadline } : {}),
        revisionsAllowed: form.revisionsAllowed ?? 3,
        usageRights: {
          licenceType: form.licenceType,
          durationMonths: form.durationMonths ?? 12,
          paidAdvertising: form.paidAdvertising,
          whitelisting: form.whitelisting,
        },
        ...(form.exclusivity.trim() ? { exclusivity: form.exclusivity.trim() } : {}),
        ...(form.otherTerms.trim() ? { otherTerms: form.otherTerms.trim() } : {}),
        ...(form.expiresAt ? { expiresAt: form.expiresAt } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      });
    } catch (e) {
      setError(e);
    }
  }

  if (!form) return null;

  return (
    <Drawer
      open={open}
      onClose={busy ? undefined : onClose}
      dismissible={!busy}
      title={basedOn ? `Counter with V${nextVersion}` : `Proposal V${nextVersion}`}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button>
          <button
            onClick={send}
            disabled={busy || issues.length > 0}
            className="btn-cta"
            title={issues.length > 0 ? issues[0] : undefined}
          >
            {busy ? <><Spinner className="w-4 h-4" /> Sending…</> : `Send V${nextVersion}`}
          </button>
        </div>
      )}
    >
      <div className="space-y-5">
        {basedOn && (
          <p className="text-sm text-muted leading-relaxed">
            Pre-filled from the version you are answering. Change only what you want to
            change — the rest is carried over, and the other side sees exactly which
            terms moved.
          </p>
        )}

        {error && (
          <div className="rounded-xl2 border border-rose-200 bg-rose-50 p-3.5">
            <p className="text-sm text-rose-800">{error.message}</p>
          </div>
        )}

        <SubGroup title="The work">
          <div>
            <span className="field-label">Content formats and quantity</span>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {ALL_CONTENT_TYPES.map((t) => {
                const on = form.contentItems.some((i) => i.contentType === t);
                return (
                  <button
                    key={t} type="button" onClick={() => toggleType(t)} aria-pressed={on}
                    className={`chip transition-colors focusable ${on ? '!bg-brand-600 !text-white' : 'hover:!bg-bg'}`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
            {form.contentItems.length > 0 && (
              <div className="mt-3 space-y-2">
                {form.contentItems.map((i) => (
                  <div key={i.contentType} className="flex items-center gap-3">
                    <span className="text-sm text-ink flex-1 min-w-0 truncate">{i.contentType}</span>
                    <label className="sr-only" htmlFor={`qty-${i.contentType}`}>
                      {`How many ${i.contentType}`}
                    </label>
                    <input
                      id={`qty-${i.contentType}`}
                      type="number" min="1" max="500"
                      value={i.quantity}
                      onChange={(e) => setQty(i.contentType, Number(e.target.value) || 1)}
                      className="field tnum w-20 shrink-0"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label htmlFor="pr-deliverables" className="field-label">Deliverables, in words</label>
            <textarea
              id="pr-deliverables"
              value={form.deliverables}
              onChange={(e) => set('deliverables', e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Two reels, 30–45s each, shot in daylight. Product shown in use."
              className="field mt-1.5 leading-relaxed"
            />
          </div>
        </SubGroup>

        {/* No hint here — `LineListField` already renders "One per line." under
            each box, and saying it twice reads as two different instructions. */}
        <SubGroup title="Creative guidelines">
          <LineListField
            id="pr-dos" label="Do" values={form.dos}
            onChange={(v) => set('dos', v)}
            placeholder={'Show the product being used, not just held\nMention the monsoon frizz angle'}
          />
          <LineListField
            id="pr-donts" label="Don’t" values={form.donts}
            onChange={(v) => set('donts', v)}
            placeholder={'No competing brands in frame\nNo filters that change the product colour'}
          />
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label htmlFor="pr-tags" className="field-label">Hashtags</label>
              <input
                id="pr-tags" value={form.hashtags}
                onChange={(e) => set('hashtags', e.target.value)}
                placeholder="monsoonhair, ad"
                className="field mt-1.5"
              />
            </div>
            <div>
              <label htmlFor="pr-mentions" className="field-label">Mentions</label>
              <input
                id="pr-mentions" value={form.mentions}
                onChange={(e) => set('mentions', e.target.value)}
                placeholder="mamaearth"
                className="field mt-1.5"
              />
            </div>
          </div>
        </SubGroup>

        <SubGroup title="Money and timeline">
          <NumberField
            id="pr-amount" label="Payment" value={form.amount}
            onChange={(v) => set('amount', v)} min={0} prefix="₹"
          />
          <DateField
            id="pr-start" label="Work starts" value={form.startDate}
            onChange={(v) => set('startDate', v)}
            hint="Optional."
          />
          <DateField
            id="pr-deadline" label="Deliverable deadline" value={form.deadline}
            onChange={(v) => set('deadline', v)}
            min={form.startDate ?? undefined}
          />
          <NumberField
            id="pr-rev" label="Included revision rounds" value={form.revisionsAllowed}
            onChange={(v) => set('revisionsAllowed', v)} min={0} max={10}
            hint="Three is the platform standard. Further rounds are paid scope."
          />
        </SubGroup>

        <SubGroup title="Usage rights" hint="Policy 8 — part of scope, so it is agreed here rather than after the work.">
          <SelectField
            id="pr-licence" label="Licence" value={form.licenceType}
            onChange={(v) => set('licenceType', v)} options={LICENCES} placeholder=""
          />
          <NumberField
            id="pr-duration" label="Duration, months" value={form.durationMonths}
            onChange={(v) => set('durationMonths', v)} min={1} max={120}
          />
          <div className="space-y-2">
            {[
              ['paidAdvertising', 'Use in paid advertising'],
              ['whitelisting', 'Run ads from the creator’s handle'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox" checked={form[key]}
                  onChange={(e) => set(key, e.target.checked)}
                  className="focusable"
                />
                <span className="text-sm text-ink">{label}</span>
              </label>
            ))}
          </div>
        </SubGroup>

        <SubGroup title="Anything else" hint="Optional.">
          <div>
            <label htmlFor="pr-excl" className="field-label">Exclusivity</label>
            <input
              id="pr-excl" value={form.exclusivity} maxLength={500}
              onChange={(e) => set('exclusivity', e.target.value)}
              placeholder="No competing hair care brand for 30 days after posting"
              className="field mt-1.5"
            />
          </div>
          <div>
            <label htmlFor="pr-other" className="field-label">Other agreed terms</label>
            <textarea
              id="pr-other" value={form.otherTerms} rows={3} maxLength={2000}
              onChange={(e) => set('otherTerms', e.target.value)}
              placeholder="Anything the fields above do not cover."
              className="field mt-1.5 leading-relaxed"
            />
          </div>
          <DateField
            id="pr-expires" label="This proposal expires" value={form.expiresAt}
            onChange={(v) => set('expiresAt', v)} min={todayISO()}
            hint="Optional. A proposal cannot be withdrawn once sent, so an expiry is the only way to time-limit it."
          />
          <div>
            <label htmlFor="pr-note" className="field-label">Note to the other party</label>
            <textarea
              id="pr-note" value={form.note} rows={2} maxLength={500}
              onChange={(e) => set('note', e.target.value)}
              placeholder="Why you are proposing these terms."
              className="field mt-1.5 leading-relaxed"
            />
            <p className="text-xs text-muted mt-1.5">
              A note explains a position — it is not part of the agreed terms.
            </p>
          </div>
        </SubGroup>

        {issues.length > 0 && (
          <ul className="rounded-xl2 border border-money-200 bg-money-50 p-3.5 space-y-1">
            {issues.map((i) => <li key={i} className="text-xs text-money-800">{i}</li>)}
          </ul>
        )}
      </div>
    </Drawer>
  );
}