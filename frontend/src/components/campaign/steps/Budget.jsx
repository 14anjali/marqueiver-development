import { useMemo } from 'react';
import { SectionCard, Field, Toggle } from '../../profile/shared';
import { Money } from '../../feedback';
import { NumberField, SelectField, SubGroup } from '../wizard';
import { PAYMENT_MODELS, PAYMENT_MODEL_LABEL } from '../vocab';

/**
 * Section D — what the brand is paying.
 *
 * ── One fee, one field ─────────────────────────────────────────────────────
 *
 * "Creator fee" writes `campaign.budget`, the field that already existed and
 * that an application seeds a deal's escrow amount from. There is no second
 * copy inside `commercials`: two places to store the number a payment is made
 * against is two numbers that can disagree.
 *
 * ── The total is shown, not stored ─────────────────────────────────────────
 *
 * Fee × creators is arithmetic, so it is computed where it is displayed. Storing
 * it would mean a third number to keep in step, and a stale total on a campaign
 * whose fee was edited afterwards.
 *
 * Policy 14.1 is stated plainly here: the 12.5% commission comes out of the
 * collaboration value rather than being added to it, so the number the brand
 * types is the number the brand pays. A brand that assumes otherwise budgets
 * wrongly, and finds out at the escrow screen.
 */
const COMMISSION_PCT = 12.5;

export default function Budget({ value, patch, errors = {} }) {
  const c = value.commercials ?? {};
  const set = (changes) => patch({ commercials: { ...c, ...changes } });
  const setBlock = (key, changes) => set({ [key]: { ...(c[key] ?? {}), ...changes } });

  const fee = Number(value.budget) || 0;
  const count = Number(c.creatorCount) || 0;
  const total = useMemo(() => fee * count, [fee, count]);

  return (
    <div className="space-y-5">
      <SectionCard
        title="Budget"
        description="What each creator is paid, and how many you are hiring."
      >
        <div className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-5">
            <NumberField
              id="cw-fee"
              label="Creator fee"
              prefix="₹"
              min={0}
              value={value.budget ?? null}
              onChange={(budget) => patch({ budget: budget ?? 0 })}
              error={errors.budget}
              placeholder="45000"
              hint="Per creator, for everything in the deliverables list."
            />
            <NumberField
              id="cw-count"
              label="Number of creators"
              min={1}
              max={500}
              value={c.creatorCount ?? null}
              onChange={(creatorCount) => set({ creatorCount })}
              error={errors.creatorCount}
              placeholder="5"
            />
          </div>

          {total > 0 && (
            <div className="panel-money rounded-xl2 p-4 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-money-700">
                  Total campaign budget
                </p>
                <p className="text-xs text-muted mt-1">
                  {count} creator{count === 1 ? '' : 's'} × <Money amount={fee} className="!text-xs" />
                </p>
              </div>
              <p className="font-display font-extrabold text-xl text-ink">
                <Money amount={total} className="!text-xl" />
              </p>
            </div>
          )}

          <SelectField
            id="cw-model"
            label="Payment model"
            value={c.paymentModel ?? 'fixed'}
            onChange={(paymentModel) => set({ paymentModel })}
            options={PAYMENT_MODELS.map((m) => ({ value: m, label: PAYMENT_MODEL_LABEL[m] }))}
            placeholder=""
            hint="How the fee is structured. Every model still runs through Marqueiver escrow."
          />

          <p className="text-xs text-muted leading-relaxed">
            Marqueiver&apos;s {COMMISSION_PCT}% commission is deducted from the collaboration value,
            not added on top — the fee you enter is what you pay, and the creator receives it
            less commission.
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="What else is on offer"
        description="Anything beyond the fee. Creators weigh these when deciding whether to apply."
      >
        <div className="space-y-6">
          <SubGroup title="Product or gifting">
            <Toggle
              checked={Boolean(c.product?.offered)}
              onChange={(offered) => setBlock('product', { offered })}
              label="The creator receives product"
            />
            {c.product?.offered && (
              <>
                <Field
                  id="cw-prod-desc"
                  label="What they receive"
                  textarea
                  rows={3}
                  value={c.product?.description}
                  onChange={(description) => setBlock('product', { description })}
                  maxLength={500}
                  placeholder="Full monsoon range — shampoo, conditioner and serum."
                />
                <NumberField
                  id="cw-prod-val"
                  label="Indicative retail value"
                  prefix="₹"
                  min={0}
                  value={c.product?.value ?? null}
                  onChange={(v) => setBlock('product', { value: v })}
                  placeholder="3500"
                  hint="So a creator can judge a barter offer honestly."
                />
              </>
            )}
          </SubGroup>

          <SubGroup title="Travel">
            <Toggle
              checked={Boolean(c.travel?.offered)}
              onChange={(offered) => setBlock('travel', { offered })}
              label="Travel is reimbursed"
            />
            {c.travel?.offered && (
              <>
                <NumberField
                  id="cw-travel-cap"
                  label="Reimbursement cap"
                  prefix="₹"
                  min={0}
                  value={c.travel?.cap ?? null}
                  onChange={(cap) => setBlock('travel', { cap })}
                  placeholder="10000"
                  hint="Leave blank if there is no cap."
                />
                <Field
                  id="cw-travel-notes"
                  label="What is covered"
                  value={c.travel?.notes}
                  onChange={(notes) => setBlock('travel', { notes })}
                  maxLength={300}
                  placeholder="Return travel to the shoot location, against receipts."
                />
              </>
            )}
          </SubGroup>

          <SubGroup
            title="Performance bonus"
            hint="Described here as part of the brief. Any bonus is agreed and paid inside the collaboration, like any other term."
          >
            <Toggle
              checked={Boolean(c.performanceBonus?.offered)}
              onChange={(offered) => setBlock('performanceBonus', { offered })}
              label="A performance or affiliate bonus is on offer"
            />
            {c.performanceBonus?.offered && (
              <Field
                id="cw-bonus"
                label="How it works"
                textarea
                rows={3}
                value={c.performanceBonus?.description}
                onChange={(description) => setBlock('performanceBonus', { description })}
                maxLength={500}
                placeholder="10% of tracked sales through your code, for 60 days."
              />
            )}
          </SubGroup>
        </div>
      </SectionCard>
    </div>
  );
}