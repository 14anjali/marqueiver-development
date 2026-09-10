import { useState, useEffect } from 'react';
import AdminPage, { AdminList, AdminRow } from '../../components/AdminPage';
import { Modal } from '../../components/overlay';
import { StatusPill, Money } from '../../components/feedback';
import { api } from '../../lib/api';
import { Spinner, useToast } from '../../lib/ui-state';

/**
 * Deal oversight.
 *
 * The redesign fixed a data bug, not just a look. This page carried its own
 * hand-written map of deal states, and three of the ten names in it do not
 * exist in the state machine:
 *
 *   invited        → the state is `invitation`
 *   negotiating    → the state is `negotiation`
 *   escrow_funded  → the state is `escrow_pending`
 *
 * So those styles never applied, and five real states — `invitation`,
 * `negotiation`, `escrow_pending`, `resolution`, `declined` — had no styling at
 * all and fell through to grey. Worse, `escrow_funded` was also a filter chip:
 * pressing it queried a state the server has never heard of and always returned
 * an empty list, which reads as "no deals are awaiting payment" rather than as a
 * broken filter.
 *
 * Both now come from `StatusPill` and the real state list, so this page cannot
 * drift from the backend again.
 */

/** Filters that map to states the server actually has. */
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'disputed', label: 'Disputed' },
  { id: 'escrow_pending', label: 'Awaiting payment' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'revision', label: 'In revision' },
  { id: 'resolution', label: 'Resolution' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

/** Where an admin can still intervene — escrow is funded and at risk. */
const RESOLVABLE = new Set(['disputed', 'in_progress', 'submitted', 'revision', 'resolution']);

function ResolveModal({ deal, onClose, onDone }) {
  const [to, setTo] = useState('completed');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const noteValid = note.trim().length >= 3;

  async function submit(e) {
    e?.preventDefault();
    if (!noteValid) return;
    setBusy(true);
    try {
      await api.adminResolveDeal(deal._id, to, note);
      toast.push('Deal resolved', 'success');
      onDone();
    } catch (err) { toast.push(err.message, 'error'); }
    finally { setBusy(false); }
  }

  const OUTCOMES = [
    { id: 'completed', label: 'Release escrow to the creator', tone: 'text-jade-700' },
    { id: 'cancelled', label: 'Refund escrow to the brand', tone: 'text-money-700' },
    { id: 'in_progress', label: 'Send back to in progress', tone: 'text-ink' },
  ];

  return (
    <Modal
      open={Boolean(deal)}
      onClose={busy ? undefined : onClose}
      dismissible={!busy}
      title={`Resolve — ${deal.title}`}
      description="This moves money. The note is written to the audit log and both parties can be shown it."
      size="sm"
    >
      <form onSubmit={submit}>
        <fieldset className="mb-4">
          <legend className="field-label mb-2">Outcome</legend>
          <div className="grid gap-2">
            {OUTCOMES.map((o) => (
              <label
                key={o.id}
                className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors text-sm
                  ${to === o.id ? 'border-brand-300 bg-brand-50/60' : 'border-line hover:bg-bg'}`}
              >
                <input
                  type="radio" name="outcome" value={o.id}
                  checked={to === o.id} onChange={() => setTo(o.id)}
                  className="accent-brand-600 focusable"
                />
                <span className={`font-medium ${o.tone}`}>{o.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label htmlFor="resolve-note" className="field-label">Resolution note</label>
        <textarea
          id="resolve-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="What was decided, and why."
          className="field resize-none"
        />
        <div className="flex justify-between items-baseline mt-1.5 mb-5">
          <span className="text-xs text-muted">
            {noteValid ? 'Recorded in the audit log.' : 'Required — at least 3 characters.'}
          </span>
          <span className="text-xs text-muted tnum">{note.length}/500</span>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy || !noteValid} className="btn-money">
            {busy ? <><Spinner className="w-4 h-4" /> Resolving…</> : 'Confirm resolution'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function AdminDeals() {
  const [deals, setDeals] = useState([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [resolving, setResolving] = useState(null);

  const load = async (f = filter) => {
    setLoading(true); setError(null);
    try {
      const params = f === 'all' ? {} : f === 'disputed' ? { disputed: 'true' } : { state: f };
      const { data, meta } = await api.adminDeals(params);
      setDeals(data || []); setTotal(meta?.total ?? (data || []).length);
    } catch (e) { setError(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const active = FILTERS.find((f) => f.id === filter);

  return (
    <>
      <AdminPage
        title="Deal oversight"
        description={`${total} ${total === 1 ? 'deal' : 'deals'} across every state. Escrow can only be moved from here while it is funded and at risk.`}
        loading={loading}
        error={error}
        onRetry={() => load()}
        isEmpty={!deals.length}
        emptyTitle={filter === 'all' ? 'No deals yet' : `No deals in ${active?.label.toLowerCase()}`}
        emptySub={filter === 'all'
          ? 'Deals appear here as soon as a brand invites a creator or a creator applies to a campaign.'
          : 'Try another filter — this one is currently empty.'}
        emptyAction={filter !== 'all' && (
          <button onClick={() => { setFilter('all'); load('all'); }} className="btn-outline mt-1">
            Show all deals
          </button>
        )}
        width="max-w-[1100px]"
      >
        {/* Filters live inside the content so they are not shown over a skeleton. */}
        <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => { setFilter(f.id); load(f.id); }}
              className={`pill whitespace-nowrap transition-all duration-200 focusable ${
                filter === f.id
                  ? 'bg-brand-600 text-white shadow-flat'
                  : 'bg-white border border-line text-muted hover:border-brand-200 hover:text-ink'}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <AdminList>
          {deals.map((d) => (
            <AdminRow key={d._id}>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-ink truncate">{d.title}</div>
                <div className="text-xs text-muted mt-0.5">
                  <Money amount={d.terms?.amount} className="text-xs" />
                  <span className="mx-1.5 text-line">·</span>
                  <span className="tnum">updated {new Date(d.updatedAt).toLocaleDateString('en-IN')}</span>
                </div>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <StatusPill status={d.state} />
                {RESOLVABLE.has(d.state) && (
                  <button onClick={() => setResolving(d)} className="btn-outline text-xs px-3 py-1.5">
                    Resolve
                  </button>
                )}
              </div>
            </AdminRow>
          ))}
        </AdminList>
      </AdminPage>

      {resolving && (
        <ResolveModal
          deal={resolving}
          onClose={() => setResolving(null)}
          onDone={() => { setResolving(null); load(); }}
        />
      )}
    </>
  );
}
