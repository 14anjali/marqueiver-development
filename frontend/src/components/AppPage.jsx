import { motion } from 'framer-motion';
import AppShell from './AppShell';
import { SkeletonList } from './feedback';
import { ErrorBlock, EmptyBlock } from '../lib/ui-state';
import { page, stagger, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';

/**
 * The frame for a signed-in page.
 *
 * The counterpart to AdminPage, for creator and brand screens. Same reasoning:
 * every page had written its own header and its own
 * `loading ? … : error ? … : empty ? …` chain, and they had drifted — different
 * gutters, different heading sizes, some with a retry and some without, and
 * `LoadingBlock` putting a spinner on an empty page so the layout jumped when
 * the data arrived.
 *
 * These screens carry slightly more motion than the admin ones: a creator
 * opening their deals is being shown their work, not operating a console.
 */
export default function AppPage({
  title,
  description,
  actions,
  toolbar,
  loading,
  error,
  onRetry,
  isEmpty,
  emptyTitle = 'Nothing here yet',
  emptySub,
  emptyAction,
  emptyIcon,
  skeletonRows = 3,
  width = 'max-w-[1100px]',
  children,
}) {
  const reduced = usePrefersReducedMotion();

  return (
    <AppShell>
      <motion.div
        variants={withReducedMotion(page, reduced)}
        initial="hidden"
        animate="visible"
        className={`${width} mx-auto px-4 sm:px-6 py-6 sm:py-8`}
      >
        <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
          <div className="min-w-0">
            <h1 className="font-display font-extrabold text-xl sm:text-2xl text-ink">{title}</h1>
            {description && (
              <p className="text-muted text-sm mt-1 max-w-prose leading-relaxed">{description}</p>
            )}
          </div>
          {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
        </header>

        {/*
          A toolbar — filters, search — sits above the content but below the
          header, and is hidden while loading. Filters over a skeleton invite a
          click that does nothing.
        */}
        {toolbar && !loading && !error && <div className="mb-4">{toolbar}</div>}

        {loading ? (
          <SkeletonList count={skeletonRows} label={`Loading ${String(title).toLowerCase()}…`} />
        ) : error ? (
          <ErrorBlock error={error} onRetry={onRetry} />
        ) : isEmpty ? (
          <EmptyBlock title={emptyTitle} sub={emptySub} action={emptyAction} icon={emptyIcon} />
        ) : (
          <motion.div
            variants={withReducedMotion(stagger, reduced)}
            initial="hidden"
            animate="visible"
          >
            {children}
          </motion.div>
        )}
      </motion.div>
    </AppShell>
  );
}

/**
 * A horizontal filter rail.
 *
 * Scrolls rather than wraps on a phone: a wrapped rail of ten chips eats half
 * the screen before any content is visible. `role="tablist"` because that is
 * what it behaves like.
 */
export function FilterRail({ options, value, onChange, label = 'Filter' }) {
  return (
    <div
      className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1"
      role="tablist"
      aria-label={label}
    >
      {options.map((o) => {
        const id = typeof o === 'string' ? o : o.id;
        const text = typeof o === 'string' ? o : o.label;
        const count = typeof o === 'string' ? undefined : o.count;
        const on = value === id;

        return (
          <button
            key={id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(id)}
            className={`pill whitespace-nowrap transition-all duration-200 focusable ${
              on
                ? 'bg-brand-600 text-white shadow-flat'
                : 'bg-white border border-line text-muted hover:border-brand-200 hover:text-ink'}`}
          >
            {text}
            {count !== undefined && (
              <span className={`tnum text-[10px] ${on ? 'text-white/70' : 'text-muted/70'}`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
