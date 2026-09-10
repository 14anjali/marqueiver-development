import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import AppPage from '../components/AppPage';
import CreatorCard from '../components/CreatorCard';
import { Bookmark, X } from '../components/icons';
import { AnimatedNumber } from '../components/feedback';
import { api } from '../lib/api';
import { creatorToCard } from '../lib/normalize';
import { toast as toastMotion, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';
import { useToast } from '../lib/ui-state';

/**
 * Creators this brand has bookmarked.
 *
 * The empty state was the substance of the last change. It used to say "No
 * saved creators yet — tap the heart icon on any creator card", which describes
 * a gesture on a page the reader is not currently on and gives them nothing to
 * press. It sends them to discovery, which is where saving actually happens.
 *
 * ── What this pass fixed ────────────────────────────────────────────────────
 *
 *  1. **Unsaving was instant and irreversible.** The heart sits in the corner of
 *     a card that is itself one big click target, so it is easy to hit by
 *     accident — and one tap removed a creator from a shortlist a brand may
 *     have spent an afternoon building, with the card gone from the grid before
 *     the finger lifted. Getting it back means going to discovery and finding
 *     that creator again by name, from memory. There is a ten-second undo now,
 *     which is how long it takes to notice.
 *  2. **`btn-cta`**, a class from the retired vocabulary, on the empty state's
 *     only action.
 *  3. The cards were wrapped in a second `motion.div` carrying the same `rise`
 *     variants the card now carries itself, so each one animated twice.
 */
const UNDO_MS = 10_000;

export default function SavedCreatorsPage() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /** The last removal, held long enough to be taken back. */
  const [undo, setUndo] = useState(null);
  const undoTimer = useRef(null);

  const nav = useNavigate();
  const toast = useToast();
  const reduced = usePrefersReducedMotion();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.listSavedCreators();
      setCards((data || []).map(creatorToCard));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // A pending undo must not outlive the page, or its timer fires against a
  // component that is gone.
  useEffect(() => () => clearTimeout(undoTimer.current), []);

  const openCreator = (c) => nav(`/creator/${c.id}`, { state: { creator: c.raw || c } });

  const onSaveChange = (creatorProfileId, saved) => {
    // Unsaving from this page removes the card — leaving it would show a saved
    // list containing something that is no longer saved.
    if (saved) return;

    /*
      Read the list, then write it — not a `setCards` updater that also calls
      `setUndo` and starts a timer. A state updater has to be pure: React runs
      it twice under StrictMode in development, which would queue two timers and
      leave one of them firing at a `setUndo` after the first had already
      cleared it.
    */
    const index = cards.findIndex((c) => c.id === creatorProfileId);
    if (index === -1) return;

    // Keep the card *and its position*, so undo restores the shortlist as it
    // was rather than moving the creator to the end of it.
    setUndo({ card: cards[index], index });
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);

    setCards((list) => list.filter((c) => c.id !== creatorProfileId));
  };

  async function restore() {
    if (!undo) return;
    const { card, index } = undo;
    clearTimeout(undoTimer.current);
    setUndo(null);

    try {
      await api.saveCreator(card.id);
      setCards((list) => {
        const next = [...list];
        next.splice(Math.min(index, next.length), 0, card);
        return next;
      });
    } catch (e) {
      // The row is genuinely gone server-side; say so rather than putting a
      // card back that the next reload would remove again.
      toast.push(e.message || 'Could not restore that creator', 'error');
    }
  }

  return (
    <AppPage
      title="Saved creators"
      description={cards.length
        ? `${cards.length} creator${cards.length === 1 ? '' : 's'} shortlisted for later.`
        : 'Creators you shortlist while browsing are kept here.'}
      actions={cards.length > 0 && (
        <span className="pill-quiet tnum">
          <AnimatedNumber value={cards.length} /> saved
        </span>
      )}
      width="max-w-[1400px]"
      loading={loading}
      error={error}
      onRetry={load}
      isEmpty={!cards.length}
      emptyTitle="No saved creators yet"
      emptySub="Shortlist creators while you browse and they will be waiting here when you are ready to build a campaign."
      emptyIcon={<Bookmark className="w-6 h-6" />}
      emptyAction={<Link to="/discover" className="btn-brand mt-2">Browse creators</Link>}
      skeletonRows={4}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((c) => (
          <CreatorCard
            key={c.id}
            c={c}
            onOpen={openCreator}
            saved
            onSaveChange={onSaveChange}
          />
        ))}
      </div>

      {/*
        The undo strip. Deliberately fixed to the bottom of the viewport rather
        than placed in the flow: the card that just vanished may have been three
        screens up, and a message the user has to scroll to find is not an undo.
      */}
      <AnimatePresence>
        {undo && (
          <motion.div
            variants={withReducedMotion(toastMotion, reduced)}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="status"
            aria-live="polite"
            className="fixed inset-x-4 bottom-4 sm:left-auto sm:right-6 sm:inset-x-auto sm:w-[24rem]
                       z-40 card-lifted p-3.5 flex items-center gap-3"
          >
            <p className="text-sm text-ink flex-1 min-w-0">
              Removed <span className="font-semibold truncate">{undo.card.name}</span>
            </p>
            <button onClick={restore} className="btn-outline !py-1.5 !px-3 !text-xs shrink-0">
              Undo
            </button>
            <button
              onClick={() => { clearTimeout(undoTimer.current); setUndo(null); }}
              aria-label="Dismiss"
              className="text-muted hover:text-ink shrink-0 focusable p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </AppPage>
  );
}
