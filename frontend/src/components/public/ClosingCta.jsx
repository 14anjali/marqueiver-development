import { Link } from 'react-router-dom';
import { Reveal, RevealItem, fadeUp } from './motion';

/**
 * The closing call to action, shared by the home page and all four role pages.
 *
 * It previously lived inside HomePage and was imported from there by
 * RolePages — a page importing from another page, which is why replacing the
 * home page broke four unrelated routes. It belongs here: one component, one
 * copy of the closing claim, and no page depends on another page's internals.
 */
export default function ClosingCta({
  title = 'Start your first collaboration',
  body = 'Creating a profile and browsing is free. Charges apply on campaign payouts, and the exact fee is shown on the deal before either side commits.',
}) {
  return (
    <section className="pb-24 md:pb-32 bg-white">
      <div className="container-wide">
        <Reveal
          className="liquid-stage liquid-stage--ink liquid-lit liquid-lit-ink rounded-xl3
                     px-7 py-16 sm:px-14 sm:py-20 text-center relative overflow-hidden"
        >
          <div className="liquid-sheen opacity-25" />

          <div className="relative z-10 max-w-2xl mx-auto">
            <RevealItem variants={fadeUp}>
              <h2 className="display-section !text-white">{title}</h2>
            </RevealItem>

            <RevealItem variants={fadeUp}>
              <p className="text-lg text-white/65 mt-5 leading-relaxed">{body}</p>
            </RevealItem>

            <RevealItem
              variants={fadeUp}
              className="flex flex-col sm:flex-row gap-3 justify-center mt-9"
            >
              <Link to="/signup?role=brand" className="btn-liquid">Start hiring creators</Link>
              <Link to="/signup?role=creator" className="btn-liquid-ghost btn-liquid-ghost-ink">
                Join as a creator
              </Link>
            </RevealItem>

            <RevealItem variants={fadeUp}>
              <p className="text-xs text-white/40 mt-6">
                Google, email or WhatsApp — one verified method is all it takes.
              </p>
            </RevealItem>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export { ClosingCta };
