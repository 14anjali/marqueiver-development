import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Platform, X } from './icons';
import { Logo } from './ui';
import { SuccessMark } from './feedback';
import { rise, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';

/**
 * The screen between a social provider and the app.
 *
 * All three OAuth callbacks were the same eleven lines: read the query string,
 * forward it, render a bare spinner labelled "Finishing … connection". Three
 * copies of one behaviour, and the moment itself — the user has just handed
 * over access to their account and is waiting to find out whether it worked —
 * looked like a page that had failed to load.
 *
 * The forwarding is unchanged: same destination, same query string, same
 * `replace: true`, still in an effect on mount. What changed is what the user
 * sees while it happens, and that the outcome is acknowledged rather than
 * flashed past. The provider reports failure in the query string
 * (`?ig=error&message=…`), so the outcome is known here — showing a spinner
 * over a failure the page already knows about is the part worth fixing.
 *
 * The destination still handles the result; this does not consume it.
 */

const PLATFORM = {
  instagram: { label: 'Instagram', key: 'ig' },
  facebook: { label: 'Facebook', key: 'fb' },
  youtube: { label: 'YouTube', key: 'yt' },
};

export default function OAuthHandoff({ platform, to }) {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const reduced = usePrefersReducedMotion();

  const meta = PLATFORM[platform] ?? { label: platform, key: platform };
  const outcome = params.get(meta.key);
  const failed = outcome === 'error' || params.get('error') != null;

  useEffect(() => {
    const q = params.toString();
    nav(`${to}${q ? `?${q}` : ''}`, { replace: true });
  }, [params, nav, to]);

  return (
    <main className="auth-stage min-h-dvh grid place-items-center px-4 sm:px-6 py-8 sm:py-12">
      {/*
        The same drifting field as the auth screens, so arriving here from a
        provider lands somewhere recognisably Marqueiver rather than on a blank
        page. Decorative only — hidden from assistive tech.
      */}
      <div className="auth-orb" aria-hidden="true" />
      <div className="auth-orb auth-orb--two" aria-hidden="true" />

      <motion.div
        variants={withReducedMotion(rise, reduced)}
        initial="hidden"
        animate="visible"
        className="glass rounded-xl3 w-full max-w-[22rem] sm:max-w-sm p-6 sm:p-8 text-center relative flex flex-col"
        role="status"
        aria-live="polite"
      >
        <Logo className="mx-auto mb-7 h-6" />

        <div className="flex items-center justify-center gap-3 mb-6">
          <Platform name={platform} className="w-11 h-11" />

          {/*
            A short connector, so the two marks read as "this is joining that"
            rather than as two unrelated logos side by side.
          */}
          <span className="w-8 h-px bg-line relative" aria-hidden="true">
            <span
              className={`absolute -top-[3px] w-1.5 h-1.5 rounded-full ${
                failed ? 'bg-rose-400 right-0' : 'bg-brand-500 animate-[slidein_1.1s_ease-in-out_infinite]'
              }`}
            />
          </span>

          {failed ? (
            <span
              className="w-11 h-11 rounded-full bg-rose-50 text-rose-500 grid place-items-center"
              role="img"
              aria-label="Not connected"
            >
              <X className="w-5 h-5" />
            </span>
          ) : (
            // The shared success mark, so a connected account is confirmed with
            // the same gesture as a funded escrow or an approved deliverable.
            <SuccessMark className="w-11 h-11" />
          )}
        </div>

        <h1 className="font-display font-extrabold text-lg text-ink">
          {failed ? `${meta.label} didn’t connect` : `${meta.label} connected`}
        </h1>
        <p className="text-sm text-muted mt-2 leading-relaxed">
          {failed
            ? 'Taking you back so you can try again.'
            : 'Taking you back to Marqueiver.'}
        </p>

        {/*
          A determinate-looking bar rather than a spinner: this screen exists
          for a fraction of a second, and a spinner in that window reads as a
          stall. The bar reads as a handover.
        */}
        <span className="track mt-7 block" aria-hidden="true">
          <span
            className={`track-fill ${failed ? 'track-fill--money' : ''}`}
            style={{ width: '100%', animation: 'shimmer 1s linear infinite' }}
          />
        </span>
      </motion.div>
    </main>
  );
}
