import { Progress } from '../feedback';
import { Clock, Check, Lock } from '../icons';

/**
 * The revision rounds: how many are included, which one this is, and what each
 * one asked for.
 *
 * ── Why the count is shown before it runs out ──────────────────────────────
 *
 * Three included rounds is a budget, and a budget nobody can see gets spent
 * without a decision. A brand should know they are on their last one BEFORE
 * they write the feedback, and a creator should be able to see the same number
 * — the alternative is one party discovering the limit by hitting it, which is
 * how a collaboration ends up in Resolution by accident.
 *
 * ── What each round asked for ──────────────────────────────────────────────
 *
 * The reason is recorded per round, so "what did they actually want changed in
 * round 2" is answerable three weeks later. It is also what the creator works
 * from, so it reads as the instruction it is rather than a note attached to a
 * superseded file.
 *
 * ── After the last one ─────────────────────────────────────────────────────
 *
 * Further work is not an included revision and is not free. This says so while
 * rounds remain, not only afterwards, because "that will be extra" is
 * information a brand needs while deciding what to ask for.
 */

const STAMP = {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
};
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', STAMP) : '');

export default function RevisionRounds({ revisions, role, state }) {
  if (!revisions) return null;

  const { used = 0, allowed = 3, remaining = 0, exhausted = false, purchased = 0 } = revisions;
  const history = revisions.history ?? [];

  // Nothing to say yet on a collaboration where no revision has been asked for
  // and the limit is the ordinary one.
  if (used === 0 && history.length === 0 && state !== 'submitted') {
    return (
      <section className="card p-5">
        <h2 className="font-display font-bold text-ink text-sm mb-2">Revisions</h2>
        <p className="text-sm text-muted leading-relaxed">
          {allowed} included revision round{allowed === 1 ? '' : 's'}, none used yet.
          {' '}Anything beyond them is additional work, agreed and paid separately.
        </p>
      </section>
    );
  }

  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 className="font-display font-bold text-ink text-sm">Revisions</h2>
        <span className="text-xs text-muted tnum">
          {used} of {allowed} used
          {purchased > 0 && ` · ${purchased} purchased`}
        </span>
      </div>

      <Progress
        value={used}
        max={allowed}
        tone={exhausted ? 'money' : 'brand'}
        label={exhausted
          ? `All ${allowed} included revisions used`
          : `Revision ${used} of ${allowed} · ${remaining} left`}
      />

      {/* The line that has to be read before the last round is spent, not after. */}
      <p className={`text-xs mt-2.5 leading-relaxed ${exhausted ? 'text-money-700' : 'text-muted'}`}>
        {exhausted ? (
          <>
            <Lock className="w-3 h-3 inline mr-1" />
            Further changes are not included revisions. They are additional work:
            the brand offers a fee for extra rounds, the creator can accept or
            decline, and work restarts once it is paid.
          </>
        ) : remaining === 1 ? (
          role === 'brand'
            ? 'This is the last included revision. After it, further changes are additional work with their own fee.'
            : 'One included revision left. Anything after it is additional work, agreed and paid separately.'
        ) : (
          'Each request uses one round. Beyond the included rounds, further changes are additional work.'
        )}
      </p>

      {/* ── the rounds themselves ─────────────────────────────────────── */}
      {history.length > 0 && (
        <ol className="mt-4 pt-4 border-t border-line space-y-3">
          {history.map((r) => {
            /*
              Answered or not is read from `resolvedAt` — the fact — rather than
              from the `status` the endpoint also sends. Caught in the rendered
              page: a round whose own line said "answered 24 Oct" carried a badge
              saying "Awaiting resubmission", because the badge trusted a
              computed twin of the same fact and the twin was missing.
            */
            const answered = Boolean(r.resolvedAt);
            return (
            <li key={r.round} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`w-7 h-7 rounded-full grid place-items-center shrink-0 text-[11px] font-bold tnum ${
                  answered
                    ? 'bg-jade-50 text-jade-700'
                    : 'bg-money-50 text-money-700 border border-money-100'}`}
              >
                {r.round}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <span className="text-sm font-medium text-ink">
                    Revision {r.round} of {allowed}
                    {r.deliverableLabel && (
                      <span className="font-normal text-muted"> · {r.deliverableLabel}</span>
                    )}
                  </span>
                  <span className="text-[11px] text-muted inline-flex items-center gap-1 shrink-0">
                    {answered
                      ? <><Check className="w-3 h-3 text-jade-700" /> Resubmitted</>
                      : <><Clock className="w-3 h-3" /> Awaiting resubmission</>}
                  </span>
                </div>
                {/* The instruction the creator works from. */}
                {r.reason && (
                  <p className="text-sm text-ink bg-bg rounded-lg p-2.5 mt-1.5 leading-relaxed break-words">
                    {r.reason}
                  </p>
                )}
                <p className="text-[11px] text-muted tnum mt-1">
                  Requested {when(r.requestedAt)}
                  {r.resolvedAt && ` · answered ${when(r.resolvedAt)}`}
                </p>
              </div>
            </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}