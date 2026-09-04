import { LIFECYCLE } from '../../pages/public/content';
import { ShieldCheck, Send } from '../icons';

/**
 * Scope §4 — the campaign/deal flow, visually explained.
 *
 * This is the page's signature element, so the rest of the site stays quiet
 * around it. Numbering is used here because the content genuinely is a
 * sequence; the same treatment is deliberately not repeated elsewhere.
 *
 * Two columns of information beyond the prose carry real product rules: which
 * side acts at each stage, and whether campaign chat is open — the second one
 * is the platform behaviour people are most likely to be surprised by, so it
 * is stated in the diagram rather than buried in the FAQ.
 */
export default function LifecycleTrack({ heading = true }) {
  return (
    <section className="bg-ink text-white">
      <div className="container-page section">
        {heading && (
          <div className="max-w-2xl mb-12">
            <h2 className="font-display font-extrabold text-display-sm md:text-display-md leading-tight">
              What actually happens, from first search to final payout
            </h2>
            <p className="text-white/70 mt-4 leading-relaxed max-w-prose">
              Ten stages, each one a recorded state on the campaign. Both sides always know where a
              collaboration stands and what happens next.
            </p>
          </div>
        )}

        <ol className="relative border-l border-white/15 ml-3 md:ml-4">
          {LIFECYCLE.map((s) => (
            <li key={s.n} className="relative pl-8 md:pl-12 pb-10 last:pb-0">
              <span
                className={`absolute -left-[13px] top-0.5 w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center ring-4 ring-ink tnum ${
                  s.state === 'escrow_funded' || s.n === 9 ? 'bg-money-500 text-ink' : 'bg-brand-600 text-white'
                }`}
                aria-hidden="true"
              >
                {s.n}
              </span>

              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="font-display font-bold text-lg">{s.stage}</h3>
                <span className="text-xs text-white/50">{s.actor === 'Both' ? 'Both parties' : s.actor}</span>
                {s.chat ? (
                  <span className="inline-flex items-center gap-1 text-xs text-avail-fg bg-avail-bg rounded-full px-2 py-0.5 font-medium">
                    <Send className="w-3 h-3" /> Chat open
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-white/60 bg-white/10 rounded-full px-2 py-0.5 font-medium">
                    <ShieldCheck className="w-3 h-3" /> Offers only
                  </span>
                )}
              </div>

              <p className="text-white/70 text-sm mt-2 max-w-prose leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>

        <p className="text-white/50 text-sm mt-12 max-w-prose leading-relaxed">
          Free-text messaging opens at escrow, once money is committed. Everything before that stays in
          structured offers, so the terms both sides agreed to are always on the record.
        </p>
      </div>
    </section>
  );
}
