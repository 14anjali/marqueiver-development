import { motion } from 'framer-motion';
import AdminShell from './AdminShell';
import { SkeletonList } from './feedback';
import { ErrorBlock, EmptyBlock } from '../lib/ui-state';
import { rise, stagger, withReducedMotion, usePrefersReducedMotion } from '../lib/motion';

/**
 * The frame every admin screen sits in.
 *
 * Eight admin pages had independently written the same twelve lines: a shell, a
 * heading, a description, and the `loading ? … : error ? … : empty ? … :` chain.
 * They had drifted — different max-widths, different heading sizes, some with a
 * description and some without, one with a retry and the rest without.
 *
 * Two things this fixes beyond consistency:
 *
 *  - **The loading state matches the content.** `LoadingBlock` put a spinner in
 *    the middle of an empty page, so the layout jumped when rows arrived. A
 *    skeleton shaped like the list holds the space.
 *  - **Errors are retryable everywhere.** Several pages rendered an error with
 *    no way back except a browser reload.
 *
 * Admin screens are worked in, not admired, so the motion here is one quiet
 * entrance and nothing after it.
 */
export default function AdminPage({
  title,
  description,
  actions,
  loading,
  error,
  onRetry,
  isEmpty,
  emptyTitle = 'Nothing here yet',
  emptySub,
  emptyAction,
  skeletonRows = 4,
  width = 'max-w-[1000px]',
  children,
}) {
  const reduced = usePrefersReducedMotion();

  return (
    <AdminShell>
      <div className={`${width} mx-auto px-4 sm:px-6 py-6 sm:py-8`}>
        <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5 sm:mb-6">
          <div className="min-w-0">
            <h1 className="font-display font-extrabold text-xl sm:text-2xl text-ink">{title}</h1>
            {description && (
              <p className="text-muted text-sm mt-1 max-w-prose leading-relaxed">{description}</p>
            )}
          </div>
          {/* Actions wrap below the title on a phone rather than squeezing it. */}
          {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
        </header>

        {loading ? (
          <SkeletonList count={skeletonRows} label={`Loading ${String(title).toLowerCase()}…`} />
        ) : error ? (
          <ErrorBlock error={error} onRetry={onRetry} />
        ) : isEmpty ? (
          <EmptyBlock title={emptyTitle} sub={emptySub} action={emptyAction} />
        ) : (
          <motion.div
            variants={withReducedMotion(stagger, reduced)}
            initial="hidden"
            animate="visible"
          >
            {children}
          </motion.div>
        )}
      </div>
    </AdminShell>
  );
}

/**
 * One row in an admin list.
 *
 * A row is a record, not a card: it gets a hairline and a hover wash, not a
 * border and a shadow of its own. Stacking twenty shadowed cards is how an
 * admin list stops reading as a list.
 */
export function AdminRow({ children, className = '', onClick }) {
  const reduced = usePrefersReducedMotion();
  const interactive = Boolean(onClick);

  return (
    <motion.div
      variants={withReducedMotion(rise, reduced)}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); }
      } : undefined}
      className={`flex flex-col sm:flex-row sm:items-center gap-3 p-4 transition-colors
        ${interactive ? 'cursor-pointer hover:bg-bg focusable' : ''} ${className}`}
    >
      {children}
    </motion.div>
  );
}

/** The container those rows live in — one border, hairlines between. */
export function AdminList({ children, className = '' }) {
  return <div className={`card divide-y divide-line overflow-hidden ${className}`}>{children}</div>;
}
