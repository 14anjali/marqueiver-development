import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../../../lib/api';
import { useToast } from '../../../lib/ui-state';
import { Money } from '../../feedback';
import { X } from '../../icons';
import { rise, withReducedMotion, usePrefersReducedMotion } from '../../../lib/motion';
import { SectionCard, SaveButton } from '../shared';
import { CONTENT_TYPES } from './WorkPreferences';

/**
 * What the creator charges.
 *
 * The commission is shown per row, not as a footnote. Policy 14.1 takes 12.5%
 * out of the collaboration value rather than adding it on top, so a creator
 * entering ₹10,000 is agreeing to receive ₹8,750 — and a rate card that shows
 * only the gross figure is the most predictable source of "I thought I was
 * getting ten thousand".
 *
 * The rate is what a brand pays and what the creator agrees to; the take-home
 * is derived, live, beside it. The percentage comes from the platform rather
 * than a constant in this file, so a rate change under Policy 14.7 reaches this
 * screen without an edit.
 */
export default function RateCard({ profile, onSaved, commissionPct }) {
  const [rows, setRows] = useState(() => (profile.rateCard ?? []).map((r) => ({ ...r })));
  const [saving, setSaving] = useState(false);
  const reduced = usePrefersReducedMotion();
  const toast = useToast();

  const update = (i, key, value) => setRows((list) => {
    const next = [...list];
    next[i] = { ...next[i], [key]: value };
    return next;
  });

  const add = () => setRows((list) => [...list, { contentType: 'reel', price: 0 }]);
  const remove = (i) => setRows((list) => list.filter((_, idx) => idx !== i));

  const dirty = useMemo(
    () => JSON.stringify(rows) !== JSON.stringify(profile.rateCard ?? []),
    [rows, profile.rateCard],
  );

  // A content type twice over is two answers to one question, and the lower one
  // silently wins wherever `minRate` is computed.
  const duplicates = useMemo(() => {
    const seen = new Set();
    const dupes = new Set();
    for (const r of rows) {
      if (seen.has(r.contentType)) dupes.add(r.contentType);
      seen.add(r.contentType);
    }
    return dupes;
  }, [rows]);

  const lowest = useMemo(() => {
    const prices = rows.map((r) => Number(r.price) || 0).filter((p) => p > 0);
    return prices.length ? Math.min(...prices) : 0;
  }, [rows]);

  async function save() {
    if (duplicates.size) {
      toast.push('Each content type can only have one rate', 'error');
      return;
    }

    setSaving(true);
    try {
      const { data } = await api.updateCreator({
        // Guard the rows on the way out: a price typed and then deleted leaves
        // NaN, which serialises to null and fails validation server-side with a
        // message about a field the user cannot see.
        rateCard: rows
          .filter((r) => r.contentType)
          .map((r) => ({ contentType: r.contentType, price: Math.max(0, Number(r.price) || 0) })),
      });
      onSaved(data);
      setRows((data.rateCard ?? []).map((r) => ({ ...r })));
      toast.push('Rate card saved', 'success');
    } catch (e) {
      toast.push(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const pct = commissionPct ?? 12.5;

  return (
    <SectionCard
      title="Rate card"
      description="What you charge per deliverable. Brands filter on price, so a creator with no rates is left out of that filter rather than shown as negotiable."
      actions={
        <button onClick={add} className="btn-outline text-sm">+ Add a rate</button>
      }
      footer={<SaveButton onClick={save} busy={saving} dirty={dirty} label="Save rate card" />}
    >
      {!rows.length ? (
        <div className="rounded-xl2 border border-dashed border-line bg-bg/60 p-8 text-center">
          <p className="font-display font-bold text-ink">No rates set</p>
          <p className="text-sm text-muted mt-1.5 leading-relaxed max-w-sm mx-auto">
            Brands see &ldquo;Contact for pricing&rdquo; and you are excluded from budget filters.
            Adding even one rate puts you in front of more campaigns.
          </p>
          <button onClick={add} className="btn-brand mt-5 mx-auto justify-center">
            Add your first rate
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-2.5">
            <AnimatePresence initial={false}>
              {rows.map((row, i) => {
                const price = Math.max(0, Number(row.price) || 0);
                const commission = Math.round((price * pct) / 100);
                const isDupe = duplicates.has(row.contentType);

                return (
                  <motion.div
                    key={i}
                    layout
                    variants={withReducedMotion(rise, reduced)}
                    initial="hidden"
                    animate="visible"
                    exit={reduced ? { opacity: 0 } : { opacity: 0, x: -8 }}
                    className={`rounded-xl2 border p-3 sm:p-4 transition-colors
                                ${isDupe ? 'border-rose-200 bg-rose-50/50' : 'border-line bg-white'}`}
                  >
                    {/* Stacks below `sm`. Three controls sharing 300px meant a
                        rupee field about 70px wide. */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                      <div className="flex-1 min-w-0">
                        <label className="sr-only" htmlFor={`rate-type-${i}`}>
                          Content type for rate {i + 1}
                        </label>
                        <select
                          id={`rate-type-${i}`}
                          value={row.contentType}
                          onChange={(e) => update(i, 'contentType', e.target.value)}
                          className="w-full rounded-xl2 border border-line bg-white px-3 py-2.5 text-sm
                                     capitalize focus:border-brand-400 transition-colors focusable"
                        >
                          {CONTENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="relative flex-1 sm:flex-initial">
                          <label className="sr-only" htmlFor={`rate-price-${i}`}>
                            Price for rate {i + 1}
                          </label>
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted pointer-events-none">
                            ₹
                          </span>
                          <input
                            id={`rate-price-${i}`}
                            type="number"
                            // A negative rate card is not a thing. The field
                            // accepted one, and the row read "₹-500".
                            min={0}
                            step={500}
                            inputMode="numeric"
                            value={row.price}
                            onChange={(e) => update(i, 'price', Math.max(0, Number(e.target.value) || 0))}
                            className="w-full sm:w-40 rounded-xl2 border border-line bg-white pl-7 pr-3 py-2.5
                                       text-sm tnum focus:border-brand-400 transition-colors focusable"
                          />
                        </div>

                        <button
                          onClick={() => remove(i)}
                          aria-label={`Remove rate ${i + 1}`}
                          className="p-2 text-muted hover:text-rose-600 hover:bg-rose-50 rounded-lg
                                     shrink-0 transition-colors focusable"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {isDupe ? (
                      <p className="field-error">
                        Two rates for {row.contentType}. Keep one.
                      </p>
                    ) : price > 0 && (
                      <p className="text-xs text-muted mt-2 tnum">
                        Brand pays <Money amount={price} className="!text-xs" /> ·
                        {' '}commission {pct}% (<Money amount={commission} className="!text-xs" />) ·
                        {' '}<span className="font-semibold text-ink">you receive</span>{' '}
                        <Money amount={price - commission} className="!text-xs" />
                      </p>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {lowest > 0 && (
            <div className="panel-money rounded-xl2 p-4 mt-4">
              <p className="text-sm text-ink">
                Brands see your rates from <Money amount={lowest} /> upward, and that is the figure
                your profile is filtered by.
              </p>
            </div>
          )}

          <p className="text-xs text-muted mt-4 leading-relaxed">
            The commission is deducted from the agreed value, not added to it — a brand funds
            exactly what you agree. The rate shown when a collaboration is accepted is the rate that
            applies to it, even if platform rates change later.
          </p>
        </>
      )}
    </SectionCard>
  );
}