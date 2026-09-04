import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FAQ } from '../../pages/public/content';
import { ChevDown } from '../icons';

/**
 * Scope §4 — FAQ / supporting informational content.
 *
 * `limit` lets the home page show the first few and link through to the full
 * page, without a second copy of the questions existing anywhere.
 */
export default function FaqList({ limit }) {
  const items = limit ? FAQ.slice(0, limit) : FAQ;
  const [open, setOpen] = useState(0);

  return (
    <section className="border-t border-line bg-bg">
      <div className="max-w-3xl mx-auto px-5 section">
        <h2 className="h-display text-display-sm md:text-display-md mb-10">
          Questions people ask first
        </h2>

        <div className="divide-y divide-line border-y border-line">
          {items.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.q}>
                <button
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  aria-expanded={isOpen}
                  className="w-full flex items-start justify-between gap-4 text-left py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-lg"
                >
                  <span className="font-semibold text-ink">{f.q}</span>
                  <ChevDown
                    className={`w-5 h-5 text-muted shrink-0 mt-0.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {isOpen && <p className="text-sm text-ink-soft leading-relaxed pb-5 pr-8 max-w-prose">{f.a}</p>}
              </div>
            );
          })}
        </div>

        {limit && FAQ.length > limit && (
          <Link to="/faq" className="inline-block mt-8 text-sm font-semibold text-brand-700 hover:underline">
            All questions
          </Link>
        )}
      </div>
    </section>
  );
}
