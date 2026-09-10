import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { Money, Progress, Skeleton } from '../feedback';
import { Reveal, RevealItem, fadeUp } from './motion';

/**
 * "So what do I actually get?" — answered with arithmetic instead of prose.
 *
 * This is the first question a creator asks and the first one a brand asks, and
 * until now the public site answered neither. The FAQ mentioned a percentage in
 * a sentence; nothing showed the subtraction. A creator reading "12.5%
 * commission" still has to work out what a ₹40,000 campaign leaves them, and
 * people who cannot do that comfortably in their head assume the worse number.
 *
 * Two rules from the policy are doing the work here, and both are easy to get
 * wrong in copy:
 *
 *  - **Policy 14.5** — the brand funds the agreed value and *nothing more*. The
 *    commission comes out of the collaboration value, it is not added on top.
 *    So the brand-side reading of the same slider is a flat "you pay what you
 *    agreed", which is a stronger claim than a fee table and is worth showing.
 *  - **Policy 14.1 / 14.7** — the rate is 12.5%, it may change on notice, and
 *    the applicable rate is the one shown at acceptance. So the rate is read
 *    live from the platform rather than typed here. If the rate ever moves,
 *    this component moves with it and no one has to remember to edit a
 *    marketing page.
 *
 * The rate arrives over the network, so:
 *
 *   loading  a skeleton in the shape of the figures; the panel keeps its height
 *   error    the panel is removed rather than showing a broken calculator. A
 *            money widget that cannot reach the live rate must not fall back to
 *            a hard-coded one and present it as authoritative — a wrong number
 *            here is worse than no number
 */
export default function MoneyExplainer({ side = 'creator' }) {
  const [pct, setPct] = useState(null);
  const [failed, setFailed] = useState(false);
  const [value, setValue] = useState(40000);

  useEffect(() => {
    let live = true;
    api.platformStats()
      .then(({ data }) => {
        if (!live) return;
        // Only a usable rate counts as success; a missing field is a failure,
        // not a reason to invent 12.5.
        if (typeof data?.commissionPct === 'number') setPct(data.commissionPct);
        else setFailed(true);
      })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  const { commission, net } = useMemo(() => {
    if (pct === null) return { commission: 0, net: 0 };
    // Rounded the same way the server rounds at release, so the number a
    // creator sees here is the number they are paid.
    const c = Math.round((value * pct) / 100);
    return { commission: c, net: value - c };
  }, [value, pct]);

  if (failed) return null;

  const loading = pct === null;
  const isCreator = side === 'creator';

  return (
    <section className="py-20 md:py-28 bg-white">
      <div className="container-wide">
        <Reveal className="max-w-2xl mb-10">
          <RevealItem variants={fadeUp}>
            <p className="eyebrow">{isCreator ? 'What you take home' : 'What it costs you'}</p>
          </RevealItem>
          <RevealItem variants={fadeUp}>
            <h2 className="display-section mt-3">
              {isCreator
                ? 'One deduction, and you can see it before you accept'
                : 'You fund the agreed value. Nothing is added on top.'}
            </h2>
          </RevealItem>
          <RevealItem variants={fadeUp}>
            <p className="text-lg text-ink-soft mt-5 leading-relaxed">
              {isCreator
                ? 'Marqueiver takes a flat commission on a completed collaboration and nothing else — no listing fee, no subscription, no charge for negotiating a deal that never happens.'
                : 'The commission is taken out of the collaboration value, not charged to you separately. The figure you agree with a creator is the figure you fund into escrow.'}
            </p>
          </RevealItem>
        </Reveal>

        <div className="panel-money rounded-xl3 p-6 sm:p-9 max-w-2xl">
          <label htmlFor="mq-value" className="block text-sm font-semibold text-ink">
            {isCreator ? 'A campaign worth' : 'A campaign you agree at'}
          </label>

          {/*
            A slider rather than a text field: this is for getting a feel for the
            shape of the deduction, not for filing a return. Steps of ₹2,500 so
            dragging lands on figures people actually quote.
          */}
          <input
            id="mq-value"
            type="range"
            min={5000}
            max={500000}
            step={2500}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            disabled={loading}
            className="w-full mt-4 accent-brand-600 focusable disabled:opacity-40"
            aria-describedby="mq-value-out"
          />

          <p id="mq-value-out" className="mt-3 text-2xl sm:text-3xl font-display font-extrabold text-ink">
            <Money amount={value} />
          </p>

          <div className="mt-7 border-t border-line pt-6">
            {loading ? (
              <div aria-busy="true" aria-live="polite" aria-label="Loading the current commission rate">
                <Skeleton className="h-4 w-56 rounded" />
                <Skeleton className="h-2 w-full mt-4 rounded-full" />
                <Skeleton className="h-9 w-40 mt-6 rounded-lg" />
              </div>
            ) : (
              <>
                {/*
                  The bar makes the proportion legible before any figure is
                  read — the whole point of showing this rather than stating a
                  percentage. It is the same `Progress` used on escrow funding
                  in the product, so the visual language matches once you are
                  inside.
                */}
                <Progress
                  value={net}
                  max={value}
                  tone="done"
                  label={isCreator ? 'Your share of the collaboration value' : 'Share reaching the creator'}
                />

                <dl className="mt-6 space-y-3 text-sm">
                  <Row label="Funded into escrow by the brand" value={<Money amount={value} />} />
                  <Row
                    label={`Marqueiver commission (${pct}%)`}
                    value={<span className="text-muted">− <Money amount={commission} /></span>}
                  />
                  <div className="border-t border-line pt-3">
                    <Row
                      strong
                      label={isCreator ? 'Paid to you on approval' : 'Paid to the creator on approval'}
                      value={<Money amount={net} className="text-lg" animate />}
                    />
                  </div>
                </dl>

                <p className="text-xs text-muted mt-5 leading-relaxed">
                  {isCreator
                    ? `Commission applies only to a completed collaboration. The rate shown when you accept is the rate that applies to that deal, even if the platform rate changes later. Statutory deductions, where they apply, are shown separately on your payout.`
                    : `The rate is applied to the collaboration value at the point the creator accepts, and is shown on the deal before you fund escrow. Cancellations follow the published cancellation terms rather than this calculation.`}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({ label, value, strong = false }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? 'font-semibold text-ink' : 'text-ink-soft'}>{label}</dt>
      <dd className={`tnum shrink-0 ${strong ? 'font-bold' : ''}`}>{value}</dd>
    </div>
  );
}
