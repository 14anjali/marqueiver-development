import { Link } from 'react-router-dom';
import { Money } from '../feedback';
import { Lock, Verified } from '../icons';
import CollaborationStepper from './CollaborationStepper';
import { collaborationStatus } from './collaborationStatus';

/**
 * The top of the collaboration workspace: who, what, where it is.
 *
 * ── Why the parties are named here ─────────────────────────────────────────
 *
 * The page showed a title, an amount and a state pill. It never said who the
 * collaboration was with — `deal.brand` and `deal.creator` arrived as raw
 * ObjectIds, so there was nothing to render. Both parties now come from
 * `getDeal` as allow-listed profile summaries, and the campaign with them, so a
 * creator with four live collaborations can tell them apart without opening
 * each one.
 *
 * ── The status is stated twice, deliberately ───────────────────────────────
 *
 * Once as a badge, once as a sentence in the stepper. The badge is for
 * recognition at a glance; the sentence is the part that says what to do about
 * it. A badge alone has told everybody where they are and nobody what to do.
 *
 * ── What is locked ─────────────────────────────────────────────────────────
 *
 * Agreed terms carry a padlock with the date, and it links to nothing: the only
 * way to move them is a change request, which lives in the terms card where the
 * terms themselves are. Putting a second entry point up here would suggest the
 * header can change the agreement, which is exactly what Policy 5.2 says it
 * cannot.
 */

const fmtDate = (d) => (d
  ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : null);

/** A party, or an honest gap where a profile no longer exists. */
function Party({ label, name, sub, avatar, verified, to }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase();
  const inner = (
    <span className="flex items-center gap-2.5 min-w-0">
      {avatar ? (
        <img
          src={avatar} alt=""
          className="w-9 h-9 rounded-xl2 object-cover border border-line shrink-0"
        />
      ) : (
        <span
          aria-hidden="true"
          className="w-9 h-9 rounded-xl2 wash text-brand-600 grid place-items-center shrink-0 font-display font-bold text-sm"
        >
          {initial}
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-[11px] uppercase tracking-wide text-muted">{label}</span>
        <span className="block text-sm font-semibold text-ink truncate inline-flex items-center gap-1">
          {name}
          {verified && <Verified className="w-3.5 h-3.5 text-brand-600 shrink-0" />}
        </span>
        {sub && <span className="block text-xs text-muted truncate">{sub}</span>}
      </span>
    </span>
  );

  return (
    <div className="min-w-0">
      {to ? <Link to={to} className="focusable block hover:opacity-80 transition-opacity">{inner}</Link> : inner}
    </div>
  );
}

export default function WorkspaceHeader({
  deal, role, payments = [], binding, deliverablesApproved = false,
}) {
  const status = collaborationStatus(deal, { payments, deliverablesApproved });
  const brand = deal.parties?.brand ?? null;
  const creator = deal.parties?.creator ?? null;
  const campaign = deal.campaignSummary ?? null;

  const locked = Boolean(deal.agreedTerms?.lockedAt);

  /**
   * The headline figures are the terms IN FORCE, not `deal.terms`.
   *
   * An accepted amendment is recorded in `termsAmendments` and read back through
   * `bindingTerms`; it does not rewrite `deal.terms`, which is deliberate —
   * nothing overwrites what was agreed. But it means `deal.terms.deadline` is
   * the original, and a header that reads it announced "Due 27 Oct" above a
   * terms card that said 10 Nov. The header is where somebody checks the date
   * quickly, which makes it the worst place to be a fortnight out.
   */
  const inForce = binding ?? deal.terms ?? {};
  const due = fmtDate(inForce.deadline);
  const amount = inForce.amount ?? deal.terms?.amount;

  /*
    A brand sees the creator's profile; a creator does not get a link to the
    brand's, because there is no public brand profile page to link to. An anchor
    that goes nowhere is worse than plain text.
  */
  // `/creator/:id` resolves a CreatorProfile id, not a user id — the discovery
  // endpoint behind that page does `CreatorProfile.findById`.
  const creatorLink = creator?._id && role === 'brand' ? `/creator/${creator._id}` : null;

  return (
    <section className="card-edge p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          {/* The campaign this came from, when it came from one. Route 2 deals
              have no campaign, and inventing one would misdescribe them. */}
          {campaign ? (
            <Link
              to={`/campaigns/${campaign._id}`}
              className="text-xs font-semibold text-brand-600 hover:text-brand-700 focusable"
            >
              {campaign.title}
            </Link>
          ) : (
            <span className="text-xs text-muted">Direct collaboration</span>
          )}
          <h1 className="font-display font-extrabold text-xl text-ink mt-0.5">{deal.title}</h1>
          <p className="text-muted text-sm mt-1 flex items-center gap-1.5 flex-wrap">
            {deal.contentTypes?.join(', ') || 'Collaboration'}
            <span className="text-line">·</span>
            <Money amount={amount} className="text-sm" />
            {due && <><span className="text-line">·</span> Due {due}</>}
          </p>
        </div>
        <div className="text-right shrink-0">
          <span className={status.pill}>{status.label}</span>
          {locked && (
            <p className="text-[11px] text-muted mt-1.5 inline-flex items-center gap-1 justify-end w-full">
              <Lock className="w-3 h-3" /> Terms locked {fmtDate(deal.agreedTerms.lockedAt)}
            </p>
          )}
        </div>
      </div>

      {/* ── the two parties ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-line">
        {/*
          Policy 13.2 — only a verification the platform actually performed is
          shown as one. `verifications` is a set of booleans, and the business
          check is the one that means the company was verified; `email` and
          `social` are self-service and must not earn this badge.
        */}
        <Party
          label="Brand"
          name={brand?.companyName ?? 'Brand account unavailable'}
          sub={[brand?.industry, brand?.location].filter(Boolean).join(' · ') || null}
          avatar={brand?.logo}
          verified={Boolean(brand?.verifications?.business)}
        />
        <Party
          label="Creator"
          name={creator?.displayName ?? 'Creator account unavailable'}
          sub={creator?.headline || creator?.location || null}
          avatar={creator?.avatarUrl}
          to={creatorLink}
        />
      </div>

      {/* ── where it is, and whose move ──────────────────────────────── */}
      <div className="mt-4 pt-4 border-t border-line">
        <CollaborationStepper
          deal={deal} role={role} payments={payments}
          deliverablesApproved={deliverablesApproved}
        />
      </div>
    </section>
  );
}