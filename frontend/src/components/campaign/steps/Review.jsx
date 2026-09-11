import { SectionCard } from '../../profile/shared';
import { Skeleton } from '../../feedback';
import { Check, X, Lock } from '../../icons';
import { StepIssues } from '../wizard';
import CampaignBrief from '../CampaignBrief';

/**
 * Section H — what still stands between this campaign and being live, and the
 * campaign exactly as a creator will read it.
 *
 * ── The preview is the real thing ──────────────────────────────────────────
 *
 * `CampaignBrief` is the same component the creator's detail page renders, not
 * a summary written to look like it. That is the only way a preview stays
 * honest: a separate rendering here would drift, and a field added to one and
 * forgotten in the other is a term the brand thinks it published and no creator
 * ever sees.
 *
 * ── The checklist comes from the server ────────────────────────────────────
 *
 * `readiness` is `GET /api/campaigns/:id/readiness`, which is the same function
 * the publish gate calls. A second, local idea of "complete" would eventually
 * disagree with the one that actually decides, and the brand would be told they
 * are ready and then refused.
 */
export default function Review({ value, readiness, onJump }) {
  return (
    <div className="space-y-5">
      <SectionCard
        title="Ready to publish?"
        description="Marqueiver reviews every campaign before creators can see it. This is what the reviewer will receive."
      >
        {!readiness ? (
          <div aria-busy="true" aria-label="Checking the campaign" className="space-y-2.5">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full rounded-xl2" />)}
          </div>
        ) : readiness.ready ? (
          <div className="rounded-xl2 border border-jade-200 bg-jade-50/70 p-5 flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl2 bg-jade-500 text-white grid place-items-center shrink-0">
              <Check className="w-4 h-4" />
            </span>
            <div>
              <p className="font-display font-bold text-ink">Everything required is filled in</p>
              <p className="text-sm text-ink-soft mt-1 leading-relaxed">
                Publishing sends this to Marqueiver for review. You will be notified either way,
                and a live campaign cannot be edited — so this is the moment to read it through.
              </p>
            </div>
          </div>
        ) : (
          <>
            <StepIssues issues={readiness.blocking} />
            <ul className="mt-4 grid sm:grid-cols-2 gap-2.5">
              {readiness.sections.map((sec) => (
                <li key={sec.id}>
                  <button
                    type="button"
                    onClick={() => onJump(sec.id)}
                    className={`w-full flex items-center gap-2.5 rounded-xl2 border px-3.5 py-3 text-left
                                transition-colors focusable
                                ${sec.complete
                                  ? 'border-jade-200 bg-jade-50/50'
                                  : 'border-line bg-white hover:border-brand-300'}`}
                  >
                    <span className={`w-6 h-6 rounded-lg grid place-items-center shrink-0 ${
                      sec.complete ? 'bg-jade-500 text-white' : 'bg-bg text-muted'}`}
                    >
                      {sec.complete ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink truncate">{sec.label}</span>
                      {!sec.complete && (
                        <span className="block text-[11px] text-muted truncate">
                          {sec.missing.join(', ')}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </SectionCard>

      <SectionCard title="Preview" description="How this campaign appears to a creator.">
        <CampaignBrief campaign={value} brand={value.brandSummary} showStatus />

        <p className="text-xs text-muted mt-4 flex items-start gap-2 leading-relaxed">
          <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Only you can see this until Marqueiver approves it. Your invoicing details, GSTIN and
          contact information are never part of a campaign.
        </p>
      </SectionCard>
    </div>
  );
}