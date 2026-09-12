import { useMemo, useState } from 'react';
import { Drawer } from '../overlay';
import { NumberField, DateField, SelectField, SubGroup } from '../campaign/wizard';
import { Spinner, useToast } from '../../lib/ui-state';
import { api } from '../../lib/api';
import { Money } from '../feedback';

/**
 * Asking to change terms that are already binding, and answering such an ask.
 *
 * ── Why this is not just another proposal ──────────────────────────────────
 *
 * Before the lock, a disagreement is settled by sending a new version: nothing
 * binds yet, so the new version simply replaces the position on the table.
 * After the lock, one party is asking the other to release them from something
 * both agreed to. So it names only the fields it wants to move, a reason is
 * required, and it is answered rather than superseded.
 *
 * ── The reason is mandatory ────────────────────────────────────────────────
 *
 * Not decoration. The other party is being asked to give something up, and a
 * request with no stated reason gives them nothing to weigh — they either
 * refuse by default or accept without understanding what they agreed to. The
 * server requires it too; this is not the only enforcement.
 */

const LICENCES = [
  { value: 'default', label: 'Standard — organic social' },
  { value: 'extended', label: 'Extended — includes paid usage' },
  { value: 'full_assignment', label: 'Full assignment — all rights transfer' },
];

const dateInput = (d) => (d ? String(new Date(d).toISOString()).slice(0, 10) : null);
const todayISO = () => new Date().toISOString().slice(0, 10);

/** The fields a change request may move, and how each is edited. */
const FIELDS = [
  { key: 'deadline', label: 'Deadline', kind: 'date' },
  { key: 'startDate', label: 'Start date', kind: 'date' },
  { key: 'revisionsAllowed', label: 'Included revisions', kind: 'number', min: 0, max: 20 },
  { key: 'amount', label: 'Collaboration value', kind: 'money' },
  { key: 'deliverables', label: 'Deliverables', kind: 'text' },
  { key: 'usageRights', label: 'Usage rights', kind: 'usage' },
  { key: 'exclusivity', label: 'Exclusivity', kind: 'line' },
  { key: 'otherTerms', label: 'Other terms', kind: 'text' },
];

export default function ChangeRequestPanel({
  open, onClose, deal, role, binding, pending, onChanged,
}) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [picked, setPicked] = useState([]);
  const [values, setValues] = useState({});
  const [reason, setReason] = useState('');

  // The fee cannot move once the money is held — the server refuses it, and an
  // editor that offers the field anyway is an invitation to a 422.
  const escrowFunded = Boolean(deal?.escrow?.funded);
  const fields = useMemo(
    () => FIELDS.filter((f) => !(f.key === 'amount' && escrowFunded)),
    [escrowFunded],
  );

  const toggle = (key) => {
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
    setValues((v) => (key in v ? v : { ...v, [key]: seedFor(key, binding) }));
  };

  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }));

  const issues = useMemo(() => {
    const out = [];
    if (!picked.length) out.push('Pick at least one term to change.');
    if (reason.trim().length < 10) out.push('Say why — at least a sentence.');
    if (picked.includes('startDate') && picked.includes('deadline')
      && values.startDate && values.deadline && values.startDate > values.deadline) {
      out.push('Work cannot start after the deadline it is due.');
    }
    return out;
  }, [picked, values, reason]);

  async function send() {
    setBusy('send');
    try {
      const changes = Object.fromEntries(picked.map((k) => [k, values[k]]));
      await api.proposeChangeRequest(deal._id, changes, reason.trim());
      toast.push('Change request sent — nothing changes unless they accept', 'success');
      setPicked([]); setValues({}); setReason('');
      onChanged?.();
      onClose?.();
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function respond(accept) {
    setBusy(accept ? 'accept' : 'reject');
    try {
      await api.respondChangeRequest(deal._id, pending._id, accept);
      toast.push(accept ? 'Change accepted — the terms are amended' : 'Change declined', 'success');
      onChanged?.();
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function withdraw() {
    setBusy('withdraw');
    try {
      await api.withdrawChangeRequest(deal._id, pending._id);
      toast.push('Request withdrawn', 'success');
      onChanged?.();
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  /* ── a request waiting on someone ──────────────────────────────────────── */
  if (pending) {
    const mine = pending.proposedByRole === role;
    return (
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <h3 className="font-display font-bold text-ink">Change requested</h3>
          <span className="pill-live">{mine ? 'Waiting on them' : 'Needs your answer'}</span>
        </div>

        <p className="text-xs text-muted leading-relaxed mb-3.5">
          {mine
            ? 'The agreed terms stand unless they accept this.'
            : `The ${pending.proposedByRole} has asked to change the agreed terms. `
              + 'Nothing changes unless you accept.'}
        </p>

        <dl className="space-y-2">
          {Object.entries(pending.changes ?? {}).map(([field, to]) => (
            <div key={field} className="flex flex-wrap justify-between gap-3 py-2 border-b border-line last:border-0">
              <dt className="text-sm text-muted capitalize shrink-0">
                {field.replace(/([A-Z])/g, ' $1').toLowerCase()}
              </dt>
              <dd className="text-sm text-right min-w-0 break-words">
                <span className="line-through text-muted">{show(binding?.[field], field)}</span>
                {' → '}
                <span className="font-semibold text-ink">{show(to, field)}</span>
              </dd>
            </div>
          ))}
        </dl>

        {pending.reason && (
          <p className="text-sm text-muted mt-3.5 leading-relaxed break-words">“{pending.reason}”</p>
        )}

        <div className="flex flex-wrap gap-2 mt-4">
          {mine ? (
            <button onClick={withdraw} disabled={!!busy} className="btn-ghost">
              {busy === 'withdraw' ? <Spinner className="w-4 h-4" /> : 'Withdraw the request'}
            </button>
          ) : (
            <>
              <button onClick={() => respond(true)} disabled={!!busy} className="btn-cta">
                {busy === 'accept' ? <Spinner className="w-4 h-4" /> : 'Accept the change'}
              </button>
              <button
                onClick={() => respond(false)} disabled={!!busy}
                className="btn-ghost text-rose-500 border-rose-200"
              >
                {busy === 'reject' ? <Spinner className="w-4 h-4" /> : 'Decline'}
              </button>
            </>
          )}
        </div>
      </section>
    );
  }

  /* ── composing a request ───────────────────────────────────────────────── */
  return (
    <Drawer
      open={open}
      onClose={busy ? undefined : onClose}
      dismissible={!busy}
      title="Request a change"
      footer={(
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={!!busy} className="btn-ghost">Cancel</button>
          <button
            onClick={send}
            disabled={!!busy || issues.length > 0}
            className="btn-cta"
            title={issues.length > 0 ? issues[0] : undefined}
          >
            {busy === 'send' ? <><Spinner className="w-4 h-4" /> Sending…</> : 'Send request'}
          </button>
        </div>
      )}
    >
      <div className="space-y-5">
        <p className="text-sm text-muted leading-relaxed">
          These terms are agreed, so nothing here takes effect until the{' '}
          {role === 'brand' ? 'creator' : 'brand'} accepts. Pick only what needs to move —
          everything you leave alone stays exactly as agreed.
        </p>

        <SubGroup title="What should change">
          <div className="flex flex-wrap gap-1.5">
            {fields.map((f) => {
              const on = picked.includes(f.key);
              return (
                <button
                  key={f.key} type="button" onClick={() => toggle(f.key)} aria-pressed={on}
                  className={`chip transition-colors focusable ${on ? '!bg-brand-600 !text-white' : 'hover:!bg-bg'}`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          {escrowFunded && (
            <p className="text-xs text-muted leading-relaxed">
              The collaboration value cannot be changed once escrow is funded. Extra paid
              scope goes through additional terms instead.
            </p>
          )}
        </SubGroup>

        {picked.length > 0 && (
          <SubGroup title="New values" hint="The current value is shown beneath each one.">
            {fields.filter((f) => picked.includes(f.key)).map((f) => (
              <div key={f.key}>
                <Editor field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />
                <p className="text-xs text-muted mt-1.5">
                  Currently: <span className="text-ink">{show(binding?.[f.key], f.key)}</span>
                </p>
              </div>
            ))}
          </SubGroup>
        )}

        <div>
          <label htmlFor="cr-reason" className="field-label">Why</label>
          <textarea
            id="cr-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="The shoot location fell through and the reshoot pushes delivery by a week."
            className="field mt-1.5 leading-relaxed"
          />
          <p className="text-xs text-muted mt-1.5">
            Required. They are being asked to give something up, and a request with no
            reason gives them nothing to weigh.
          </p>
        </div>

        {issues.length > 0 && (
          <ul className="rounded-xl2 border border-money-200 bg-money-50 p-3.5 space-y-1">
            {issues.map((i) => <li key={i} className="text-xs text-money-800">{i}</li>)}
          </ul>
        )}
      </div>
    </Drawer>
  );
}

/** The current value, as the starting point for the new one. */
function seedFor(key, binding) {
  const v = binding?.[key];
  if (key === 'deadline' || key === 'startDate') return dateInput(v);
  if (key === 'usageRights') {
    return {
      licenceType: v?.licenceType ?? 'default',
      durationMonths: v?.durationMonths ?? 12,
      paidAdvertising: Boolean(v?.paidAdvertising),
      whitelisting: Boolean(v?.whitelisting),
    };
  }
  return v ?? (key === 'amount' || key === 'revisionsAllowed' ? null : '');
}

function Editor({ field, value, onChange }) {
  const id = `cr-${field.key}`;
  if (field.kind === 'date') {
    return (
      <DateField
        id={id} label={field.label} value={value} onChange={onChange}
        min={field.key === 'deadline' ? undefined : todayISO()}
      />
    );
  }
  if (field.kind === 'number' || field.kind === 'money') {
    return (
      <NumberField
        id={id} label={field.label} value={value} onChange={onChange}
        min={field.min ?? 0} max={field.max}
        prefix={field.kind === 'money' ? '₹' : undefined}
      />
    );
  }
  if (field.kind === 'usage') {
    const u = value ?? {};
    return (
      <div className="space-y-3">
        <SelectField
          id={id} label="Licence" value={u.licenceType}
          onChange={(v) => onChange({ ...u, licenceType: v })}
          options={LICENCES} placeholder=""
        />
        <NumberField
          id={`${id}-months`} label="Duration, months" value={u.durationMonths}
          onChange={(v) => onChange({ ...u, durationMonths: v })} min={1} max={120}
        />
        {[['paidAdvertising', 'Use in paid advertising'], ['whitelisting', 'Run ads from the creator’s handle']]
          .map(([k, label]) => (
            <label key={k} className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox" checked={Boolean(u[k])}
                onChange={(e) => onChange({ ...u, [k]: e.target.checked })}
                className="focusable"
              />
              <span className="text-sm text-ink">{label}</span>
            </label>
          ))}
      </div>
    );
  }
  if (field.kind === 'line') {
    return (
      <div>
        <label htmlFor={id} className="field-label">{field.label}</label>
        <input
          id={id} value={value ?? ''} maxLength={500}
          onChange={(e) => onChange(e.target.value)} className="field mt-1.5"
        />
      </div>
    );
  }
  return (
    <div>
      <label htmlFor={id} className="field-label">{field.label}</label>
      <textarea
        id={id} value={value ?? ''} rows={4} maxLength={4000}
        onChange={(e) => onChange(e.target.value)} className="field mt-1.5 leading-relaxed"
      />
    </div>
  );
}

/**
 * One-line rendering of a term value.
 *
 * `field` matters: `amount` is money and everything else that happens to be a
 * number is not. Without it this rendered "Revisions allowed: ₹3 → ₹4", which
 * reads as a price for something that is a count.
 */
function show(v, field) {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) {
    return v.map((i) => (typeof i === 'object' && i
      ? `${i.quantity ?? 1} × ${i.contentType ?? ''}`.trim() : String(i))).join(', ') || '—';
  }
  if (typeof v === 'object') {
    if (v.licenceType) {
      return [v.licenceType, v.durationMonths ? `${v.durationMonths} months` : null]
        .filter(Boolean).join(' · ');
    }
    return Object.values(v).flat().filter(Boolean).join(', ') || '—';
  }
  if (typeof v === 'number') {
    return field === 'amount' ? <Money amount={v} className="text-sm" /> : String(v);
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return String(v);
}