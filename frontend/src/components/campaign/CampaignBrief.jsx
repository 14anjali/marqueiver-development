import { Link } from 'react-router-dom';
import { Money, StatusPill } from '../feedback';
import { Check, X, MapPin, ShieldCheck } from '../icons';
import { PLATFORM_LABEL, PAYMENT_MODEL_LABEL } from './vocab';

/**
 * A campaign, rendered as a creator reads it.
 *
 * ── One rendering, two places ──────────────────────────────────────────────
 *
 * This is what the wizard's Review step shows the brand and what the detail
 * page shows a creator. They are the same component on purpose: the whole
 * point of a preview is that it is the thing itself, and two renderings of the
 * same brief drift — a field added to the wizard's preview and forgotten on the
 * creator's page is a term the brand thinks it published and nobody ever saw.
 *
 * ── What it never shows ────────────────────────────────────────────────────
 *
 * Only campaign content and the brand's public identity. The brand's invoicing
 * details, GSTIN and contact information are not in the payload at all — the
 * server's `brandSummary` names the six fields it exposes rather than
 * subtracting private ones — and `review` (Marqueiver's notes to the brand) is
 * stripped server-side for anyone who is not the owner.
 */

const dateOf = (v) => (v
  ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—');

export default function CampaignBrief({ campaign, brand, showStatus = false }) {
  const c = campaign ?? {};
  const g = c.guidelines ?? {};
  const r = c.creatorRequirements ?? {};
  const com = c.commercials ?? {};
  const s = c.schedule ?? {};
  const u = c.usageRights ?? {};
  const extras = c.extras ?? {};
  const b = brand ?? c.brandSummary ?? null;

  const total = (Number(c.budget) || 0) * (Number(com.creatorCount) || 0);

  return (
    <article className="rounded-xl3 border border-line overflow-hidden">
      <header className="bg-gradient-to-br from-brand-600 via-brand-500 to-pink-500 p-5 sm:p-6 text-white">
        {b && <BrandLine brand={b} />}

        <div className={`flex flex-wrap items-start justify-between gap-3 ${b ? 'mt-4' : ''}`}>
          <div className="min-w-0">
            <h2 className="font-display font-extrabold text-xl sm:text-2xl leading-tight break-words">
              {c.title || 'Untitled campaign'}
            </h2>
            <p className="text-sm text-white/85 mt-1.5">
              {[c.category, c.objective].filter(Boolean).join(' · ') || 'No category yet'}
            </p>
          </div>
          {showStatus && (
            <StatusPill
              status={c.status || 'draft'}
              className="shrink-0 !bg-white/20 !text-white !border-white/30"
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-4 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="w-4 h-4" />{c.location || 'India'}
          </span>
          {Number(c.budget) > 0 && (
            <span className="font-display font-bold">
              ₹{Number(c.budget).toLocaleString('en-IN')}
              <span className="font-normal text-white/80"> per creator</span>
            </span>
          )}
          {com.creatorCount > 0 && (
            <span className="text-white/85">
              {com.creatorCount} creator{com.creatorCount === 1 ? '' : 's'}
            </span>
          )}
          {c.platforms?.length > 0 && (
            <span className="text-white/85">
              {c.platforms.map((p) => PLATFORM_LABEL[p] ?? p).join(' · ')}
            </span>
          )}
        </div>
      </header>

      <div className="p-5 sm:p-6 space-y-6 bg-white">
        {c.images?.length > 0 && (
          <div className="flex gap-2.5 flex-wrap">
            {c.images.map((src, i) => (
              <img
                key={src}
                src={src}
                alt={`Campaign image ${i + 1}`}
                className="w-20 h-20 rounded-xl2 object-cover border border-line"
              />
            ))}
          </div>
        )}

        <Block label="About this campaign" empty={!c.brief?.trim()}>
          <p className="text-sm text-ink-soft leading-relaxed whitespace-pre-line">{c.brief}</p>
        </Block>

        {b && (b.tagline || b.industry || b.website) && (
          <Block label="About the brand">
            <dl className="grid sm:grid-cols-2 gap-4">
              {b.tagline && <Pair label="Tagline" value={b.tagline} />}
              {b.industry && <Pair label="Industry" value={b.industry} />}
              {b.location?.city && (
                <Pair label="Based in" value={[b.location.city, b.location.country].filter(Boolean).join(', ')} />
              )}
              {b.website && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-muted">Website</dt>
                  <dd className="text-sm mt-1">
                    <a
                      href={b.website}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-brand-700 font-medium hover:text-brand-800 break-all focusable"
                    >
                      {b.website.replace(/^https?:\/\//, '')} →
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </Block>
        )}

        <Block label="What you will make" empty={!c.deliverables?.length}>
          <ul className="space-y-2">
            {(c.deliverables ?? []).map((d, i) => (
              <li key={i} className="flex items-baseline gap-2 text-sm text-ink">
                <span className="font-display font-bold tnum">{d.quantity}×</span>
                <span>
                  {d.contentType} on {PLATFORM_LABEL[d.platform] ?? d.platform}
                  {d.durationSeconds ? ` · ${d.durationSeconds}s` : ''}
                  {d.format ? ` · ${d.format}` : ''}
                  {d.notes ? <span className="text-muted"> — {d.notes}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Block>

        <Block
          label="Content guidelines"
          empty={!(g.dos?.length || g.donts?.length || g.hashtags?.length || g.mentions?.length || g.cta || g.notes)}
        >
          <div className="space-y-4">
            {g.dos?.length > 0 && <Bullets tone="jade" title="Do" items={g.dos} />}
            {g.donts?.length > 0 && <Bullets tone="rose" title="Don't" items={g.donts} />}
            {(g.hashtags?.length > 0 || g.mentions?.length > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {[...(g.hashtags ?? []), ...(g.mentions ?? [])].map((t) => (
                  <span key={t} className="chip">{t}</span>
                ))}
              </div>
            )}
            {g.cta && <Pair label="Call to action" value={g.cta} />}
            {g.notes && <p className="text-sm text-ink-soft leading-relaxed whitespace-pre-line">{g.notes}</p>}
          </div>
        </Block>

        <Block
          label="Who can apply"
          empty={!(r.categories?.length || r.locations?.length || r.followerMin || r.languages?.length)}
        >
          <dl className="grid sm:grid-cols-2 gap-4">
            {r.categories?.length > 0 && <Pair label="Creator categories" value={r.categories.join(', ')} />}
            {r.locations?.length > 0 && <Pair label="Location" value={r.locations.join(', ')} />}
            {(r.ageMin || r.ageMax) && <Pair label="Age" value={`${r.ageMin ?? 'any'} – ${r.ageMax ?? 'any'}`} />}
            {r.genders?.length > 0 && <Pair label="Gender" value={r.genders.join(', ')} />}
            {(r.followerMin || r.followerMax) && (
              <Pair
                label="Followers"
                value={`${(r.followerMin ?? 0).toLocaleString('en-IN')} – ${r.followerMax ? r.followerMax.toLocaleString('en-IN') : 'any'}`}
              />
            )}
            {r.minEngagement != null && <Pair label="Minimum engagement" value={`${r.minEngagement}%`} />}
            {r.languages?.length > 0 && <Pair label="Languages" value={r.languages.join(', ')} />}
            {r.experience && <Pair label="Experience" value={r.experience} />}
            {(r.requireVerifiedIdentity || r.requireVerifiedSocial) && (
              <Pair
                label="Verification"
                value={[
                  r.requireVerifiedIdentity ? 'Identity verified' : null,
                  r.requireVerifiedSocial ? 'Social verified' : null,
                ].filter(Boolean).join(', ')}
              />
            )}
          </dl>

          {(r.audience?.locations?.length || r.audience?.ageRanges?.length
            || r.audience?.genders?.length || r.audience?.interests?.length) && (
            <div className="mt-4 pt-4 border-t border-line">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                The audience they want to reach
              </p>
              <dl className="grid sm:grid-cols-2 gap-4 mt-2.5">
                {r.audience.locations?.length > 0 && <Pair label="Location" value={r.audience.locations.join(', ')} />}
                {r.audience.ageRanges?.length > 0 && <Pair label="Age" value={r.audience.ageRanges.join(', ')} />}
                {r.audience.genders?.length > 0 && <Pair label="Gender" value={r.audience.genders.join(', ')} />}
                {r.audience.interests?.length > 0 && <Pair label="Interests" value={r.audience.interests.join(', ')} />}
              </dl>
            </div>
          )}
        </Block>

        <Block label="What you are paid" empty={!(Number(c.budget) > 0)}>
          <div className="space-y-3">
            <div className="panel-money rounded-xl2 p-4 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm text-ink">Fee per creator</span>
              <Money amount={Number(c.budget) || 0} />
            </div>
            <dl className="grid sm:grid-cols-2 gap-4">
              {com.paymentModel && (
                <Pair label="Payment model" value={PAYMENT_MODEL_LABEL[com.paymentModel] ?? com.paymentModel} />
              )}
              {total > 0 && <Pair label="Total campaign budget" value={`₹${total.toLocaleString('en-IN')}`} />}
              {com.product?.offered && (
                <Pair
                  label="Product"
                  value={com.product.description
                    || (com.product.value ? `Worth ₹${Number(com.product.value).toLocaleString('en-IN')}` : 'Included')}
                />
              )}
              {com.travel?.offered && (
                <Pair
                  label="Travel"
                  value={com.travel.cap
                    ? `Reimbursed up to ₹${Number(com.travel.cap).toLocaleString('en-IN')}`
                    : 'Reimbursed'}
                />
              )}
              {com.performanceBonus?.offered && (
                <Pair label="Performance bonus" value={com.performanceBonus.description || 'On offer'} />
              )}
            </dl>
            <p className="text-xs text-muted leading-relaxed">
              Paid through Marqueiver escrow. The brand funds the collaboration before work
              starts, and the 12.5% platform commission comes out of this value rather than
              being added to it.
            </p>
          </div>
        </Block>

        <Block label="Timeline" empty={!(s.applicationDeadline || c.deadline)}>
          <dl className="grid sm:grid-cols-2 gap-4">
            {s.campaignStart && <Pair label="Campaign start" value={dateOf(s.campaignStart)} />}
            {s.applicationDeadline && <Pair label="Apply by" value={dateOf(s.applicationDeadline)} />}
            {s.selectionDeadline && <Pair label="Selection by" value={dateOf(s.selectionDeadline)} />}
            {s.collaborationStart && <Pair label="Work starts" value={dateOf(s.collaborationStart)} />}
            {c.deadline && <Pair label="Content due" value={dateOf(c.deadline)} />}
            {s.reviewWindowDays && <Pair label="Brand review" value={`${s.reviewWindowDays} days`} />}
            {s.campaignEnd && <Pair label="Campaign ends" value={dateOf(s.campaignEnd)} />}
          </dl>
        </Block>

        <Block label="Usage rights" empty={!(u.channels?.length || u.durationMonths || u.perpetual)}>
          <dl className="grid sm:grid-cols-2 gap-4">
            <Pair
              label="Usage period"
              value={u.perpetual ? 'Perpetual' : u.durationMonths ? `${u.durationMonths} months` : '—'}
            />
            {u.channels?.length > 0 && <Pair label="Channels" value={u.channels.join(', ')} />}
            <Pair
              label="Paid advertising"
              value={u.paidAds?.allowed
                ? (u.paidAds.durationMonths ? `Allowed for ${u.paidAds.durationMonths} months` : 'Allowed')
                : 'Not included'}
            />
            <Pair
              label="Exclusivity"
              value={u.exclusivity?.required
                ? [u.exclusivity.category, u.exclusivity.durationMonths ? `${u.exclusivity.durationMonths} months` : null]
                  .filter(Boolean).join(' · ') || 'Required'
                : 'None'}
            />
          </dl>
        </Block>

        {extras.specialInstructions && (
          <Block label="Special instructions">
            <p className="text-sm text-ink-soft leading-relaxed whitespace-pre-line">
              {extras.specialInstructions}
            </p>
          </Block>
        )}

        {extras.questions?.length > 0 && (
          <Block label="You will be asked">
            <ul className="space-y-2">
              {extras.questions.map((q) => (
                <li key={q.key} className="text-sm text-ink flex items-baseline gap-2">
                  <span aria-hidden="true" className="text-muted">•</span>
                  <span>
                    {q.prompt || <span className="text-muted">(empty question)</span>}
                    {q.required && <span className="text-rose-600" title="Required"> *</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        )}
      </div>
    </article>
  );
}

/**
 * Who is asking, and whether Marqueiver has verified them.
 *
 * The badge is the derived level and nothing else — Policy 13.5 keeps the
 * documents behind a verification private, so a creator sees that a brand is
 * verified without seeing anything that was used to verify it.
 */
function BrandLine({ brand }) {
  const initial = (brand.companyName || '?').trim().charAt(0).toUpperCase();

  const identity = (
    <>
      {brand.logo ? (
        <img
          src={brand.logo}
          alt=""
          className="w-9 h-9 rounded-xl2 object-cover bg-white/20 shrink-0"
        />
      ) : (
        <span className="w-9 h-9 rounded-xl2 bg-white/20 grid place-items-center shrink-0 font-display font-bold">
          {initial}
        </span>
      )}
      <span className="min-w-0 flex items-center gap-1.5">
        <span className="font-semibold truncate">{brand.companyName || 'Brand'}</span>
        {brand.verified && (
          <ShieldCheck className="w-4 h-4 shrink-0" aria-label="Verified brand" />
        )}
      </span>
    </>
  );

  return brand.profileId ? (
    <Link
      to={`/brand/${brand.profileId}`}
      className="inline-flex items-center gap-2.5 text-sm hover:opacity-90 transition-opacity focusable rounded-xl2"
    >
      {identity}
    </Link>
  ) : (
    <span className="inline-flex items-center gap-2.5 text-sm">{identity}</span>
  );
}

function Block({ label, children, empty }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</h3>
      <div className="mt-2.5">
        {empty ? <p className="text-sm text-muted italic">Nothing added yet.</p> : children}
      </div>
    </section>
  );
}

function Pair({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="text-sm text-ink mt-1 break-words">{value}</dd>
    </div>
  );
}

function Bullets({ title, items, tone }) {
  return (
    <div>
      <p className={`text-xs font-semibold ${tone === 'jade' ? 'text-jade-700' : 'text-rose-700'}`}>{title}</p>
      <ul className="mt-1.5 space-y-1">
        {items.map((i) => (
          <li key={i} className="text-sm text-ink-soft flex items-start gap-2 leading-relaxed">
            {tone === 'jade'
              ? <Check className="w-3.5 h-3.5 text-jade-600 shrink-0 mt-1" />
              : <X className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-1" />}
            <span>{i}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}