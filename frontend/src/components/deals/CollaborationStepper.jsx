import { Check, Lock, Clock, X } from '../icons';
import { stageStates, nextAction, collaborationStatus, OFF_PATH } from './collaborationStatus';

/**
 * Where this collaboration is, and what the person reading it has to do.
 *
 * ── Why not the existing `Steps` bar ───────────────────────────────────────
 *
 * `components/feedback.jsx` has one, and the deal page used it: seven coloured
 * segments and the current label underneath. It answers "how far along is
 * this?" and nothing else. The four questions this has to answer are what is
 * done, what is pending, what *I* must do, and what is locked — and the last
 * one is the one a bar cannot express at all. "Not yet" and "not yet, and
 * nothing you do here will change that" look identical as a grey segment, and
 * they are the difference between a creator waiting to submit work and a
 * creator who cannot submit because the brand has not paid.
 *
 * So: five visual states, each with a shape of its own and a word, not just a
 * colour — because the difference between done and locked must survive being
 * read by someone who cannot tell jade from grey.
 *
 *   done      a tick, jade, and the stage name
 *   current   the brand gradient, and the one line saying what happens now
 *   pending   an outline, quiet
 *   locked    a padlock, and the reason in the line below
 *   skipped   struck through, for a collaboration that ended before it got here
 *
 * ── Off the path ───────────────────────────────────────────────────────────
 *
 * A revision loop, a dispute and a cancellation are not steps — drawing them as
 * steps draws a path that does not exist. They appear as a band above the
 * stepper, which is also where the eye goes first, which is right: a disputed
 * collaboration's stage is the least interesting thing about it.
 */

const DOT = {
  done: 'bg-jade-500 text-white border-jade-500',
  current: 'bg-gradient-to-br from-brand-600 to-pink-500 text-white border-transparent',
  pending: 'bg-white text-muted border-line',
  locked: 'bg-bg text-muted border-line',
  skipped: 'bg-white text-line border-line',
};

const LABEL = {
  done: 'text-ink',
  current: 'text-ink font-semibold',
  pending: 'text-muted',
  locked: 'text-muted',
  skipped: 'text-muted line-through',
};

/** The word next to the stage, so the state is readable and not only coloured. */
const NOTE = {
  done: 'Done',
  current: 'Now',
  pending: 'Pending',
  locked: 'Locked',
  skipped: 'Not reached',
};

function Dot({ state, index }) {
  const cls = `w-6 h-6 rounded-full border grid place-items-center shrink-0 text-[11px] font-bold tnum ${DOT[state]}`;
  if (state === 'done') return <span className={cls} aria-hidden="true"><Check className="w-3.5 h-3.5" /></span>;
  if (state === 'locked') return <span className={cls} aria-hidden="true"><Lock className="w-3 h-3" /></span>;
  return <span className={cls} aria-hidden="true">{index + 1}</span>;
}

export default function CollaborationStepper({ deal, role, payments = [], className = '' }) {
  const status = collaborationStatus(deal, { payments });
  const stages = stageStates(deal, { payments });
  const action = nextAction(deal, role, { payments });
  const off = OFF_PATH[status.id] ? status : null;

  return (
    <div className={className}>
      {/*
        The exception first. A collaboration in revision, dispute or cancellation
        is not "at step 4" in any sense that helps the reader.
      */}
      {off && (
        <div
          className={`rounded-xl2 border p-3.5 mb-4 ${
            status.id === 'disputed' ? 'border-rose-200 bg-rose-50'
              : status.id === 'cancelled' || status.id === 'declined' ? 'border-line bg-bg'
                : 'border-money-100 bg-money-50/60'}`}
        >
          <p className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">
            {status.id === 'cancelled' || status.id === 'declined'
              ? <X className="w-4 h-4 text-muted" />
              : <Clock className="w-4 h-4 text-money-700" />}
            {off.label}
          </p>
          {action.text && (
            <p className="text-xs text-muted mt-1 leading-relaxed">{action.text}</p>
          )}
        </div>
      )}

      <ol className="space-y-0" role="list">
        {stages.map((stage, i) => (
          <li key={stage.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <Dot state={stage.state} index={i} />
              {/* The rail between stages, jade only where the path was walked. */}
              {i < stages.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`w-px flex-1 min-h-[1.1rem] ${
                    stage.state === 'done' ? 'bg-jade-500/40' : 'bg-line'}`}
                />
              )}
            </div>
            <div className="pb-3 min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className={`text-sm ${LABEL[stage.state]}`}>{stage.label}</span>
                <span className="text-[11px] text-muted shrink-0">{NOTE[stage.state]}</span>
              </div>
              {/* The current stage carries the instruction; nothing else does. */}
              {stage.state === 'current' && !off && action.text && (
                <p className={`text-xs mt-1 leading-relaxed ${
                  action.warn ? 'text-rose-700' : action.mine ? 'text-ink' : 'text-muted'}`}
                >
                  {action.mine && <span className="font-semibold">Your move: </span>}
                  {action.text}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}