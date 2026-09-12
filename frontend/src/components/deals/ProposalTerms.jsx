import { Money } from '../feedback';

/**
 * One set of proposal terms, rendered.
 *
 * The same component shows a proposal awaiting a response, a version in the
 * history, and the locked final terms — because they are the same fields and
 * the reader is asking the same question of each. Three near-identical readouts
 * would be three chances for one of them to quietly stop showing usage rights.
 *
 * ── `changedFrom` ──────────────────────────────────────────────────────────
 *
 * Given the previous version, each field says whether it moved. A counter that
 * changes only the usage rights looks, at a glance, exactly like a counter that
 * changes everything — the diff is the whole reason a version history is worth
 * having, and without it both parties are left comparing two blocks of text by
 * eye and missing the one line that matters.
 */

const LICENCE_LABEL = {
  default: 'Standard — organic social',
  extended: 'Extended — includes paid usage',
  full_assignment: 'Full assignment — all rights transfer',
};

const fmtDate = (d) => (d
  ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—');

/** "2 × Reel, 3 × Story" — the quantity is the point, so it leads. */
export function contentSummary(items = []) {
  if (!items.length) return '';
  return items
    .map((i) => `${i.quantity ?? 1} × ${i.contentType}${i.platform ? ` (${i.platform})` : ''}`)
    .join(', ');
}

const usageSummary = (u = {}) => {
  if (!u || !u.licenceType) return '';
  const extras = [
    u.paidAdvertising && 'paid ads',
    u.whitelisting && 'whitelisting',
    u.modificationAllowed && 'edits allowed',
  ].filter(Boolean);
  return [
    LICENCE_LABEL[u.licenceType] ?? u.licenceType,
    u.durationMonths ? `${u.durationMonths} months` : null,
    extras.length ? extras.join(', ') : null,
  ].filter(Boolean).join(' · ');
};

/**
 * Every term, flattened to comparable strings.
 *
 * Comparison is on the rendered value rather than the raw field, so a licence
 * that arrives as `default` on one version and is absent on another does not
 * read as a change when both display the same thing.
 */
export function termRows(t = {}) {
  return [
    ['Payment', t.amount != null ? `₹${Number(t.amount).toLocaleString('en-IN')}` : '—'],
    ['Content', contentSummary(t.contentItems) || '—'],
    ['Deliverables', t.deliverables || '—'],
    ['Starts', fmtDate(t.startDate)],
    ['Due', fmtDate(t.deadline)],
    ['Revisions included', t.revisionsAllowed != null ? String(t.revisionsAllowed) : '—'],
    ['Usage rights', usageSummary(t.usageRights) || '—'],
    ['Exclusivity', t.exclusivity || 'None'],
    ['Other terms', t.otherTerms || '—'],
  ];
}

export default function ProposalTerms({ terms, changedFrom, compact = false }) {
  const rows = termRows(terms);
  const before = changedFrom ? Object.fromEntries(termRows(changedFrom)) : null;

  const g = terms?.guidelines ?? {};
  const hasGuidelines = [g.dos, g.donts, g.hashtags, g.mentions]
    .some((a) => a?.length) || Boolean(g.notes);

  return (
    <div>
      <dl className={compact ? 'space-y-1' : 'space-y-1.5'}>
        {rows.map(([label, value]) => {
          // Only fields that actually moved are marked — and only when there is
          // a previous version to have moved from.
          const changed = before && before[label] !== undefined && before[label] !== value;
          return (
            <div key={label} className="flex justify-between gap-4 items-baseline">
              <dt className="text-muted text-sm shrink-0">{label}</dt>
              <dd className={`text-right min-w-0 break-words text-sm ${
                changed ? 'text-ink font-semibold' : 'text-ink'}`}
              >
                {label === 'Payment' && terms?.amount != null
                  ? <Money amount={terms.amount} className="text-sm" />
                  : value}
                {/*
                  `pill-live`, not `pill-warn`. Rose warns in this design system,
                  and a term that moved is not a problem — it is the thing the
                  reader came to find.
                */}
                {changed && (
                  <span className="pill-live ml-2 align-middle !text-[10px] !px-2 !py-0.5">changed</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      {hasGuidelines && !compact && (
        <div className="mt-3.5 pt-3.5 border-t border-line">
          <p className="text-xs font-semibold text-muted mb-2">Creative guidelines</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
            {[['Do', g.dos], ['Don’t', g.donts]].filter(([, v]) => v?.length).map(([label, items]) => (
              <div key={label}>
                <p className="text-[11px] font-semibold text-muted">{label}</p>
                <ul className="mt-1 space-y-0.5">
                  {items.map((i) => (
                    <li key={i} className="text-xs text-ink leading-relaxed break-words">• {i}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {(g.hashtags?.length > 0 || g.mentions?.length > 0) && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {(g.hashtags ?? []).map((h) => (
                <span key={h} className="chip">#{String(h).replace(/^#/, '')}</span>
              ))}
              {(g.mentions ?? []).map((m) => (
                <span key={m} className="chip">@{String(m).replace(/^@/, '')}</span>
              ))}
            </div>
          )}
          {g.notes && <p className="text-xs text-muted mt-2.5 leading-relaxed break-words">{g.notes}</p>}
        </div>
      )}
    </div>
  );
}