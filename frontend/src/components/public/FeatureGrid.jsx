import { FEATURES } from '../../pages/public/content';
import * as Icons from '../icons';

/**
 * Scope §4 — "Platform Features: creator discovery, campaign management,
 * negotiation, payments/escrow, messaging, notifications, profiles, reviews,
 * analytics, and administration."
 *
 * Deliberately not built as nine identical bordered cards; the icon and a rule
 * carry the structure so the lifecycle band above stays the loudest thing on
 * the page.
 */
export default function FeatureGrid() {
  return (
    <section className="container-page section">
      <div className="max-w-2xl mb-12">
        <h2 className="h-display text-display-sm md:text-display-md">
          Everything a collaboration needs, in one place
        </h2>
        <p className="lede mt-4">
          Discovery, terms, payment and delivery all sit on the same record, so nothing depends on
          someone remembering what was said in a chat.
        </p>
      </div>

      <div className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => {
          const Icon = Icons[f.icon];
          return (
            <div key={f.title} className="border-t border-line pt-5">
              {Icon && (
                <span className="inline-flex w-9 h-9 rounded-lg bg-brand-50 text-brand-700 items-center justify-center mb-3">
                  <Icon className="w-5 h-5" />
                </span>
              )}
              <h3 className="font-display font-bold text-ink">{f.title}</h3>
              <p className="text-sm text-ink-soft mt-2 leading-relaxed">{f.body}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
