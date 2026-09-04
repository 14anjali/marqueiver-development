import { Link } from 'react-router-dom';
import { PublicLayout } from '../../components/public/PublicChrome';
import LifecycleTrack from '../../components/public/LifecycleTrack';
import FeatureGrid from '../../components/public/FeatureGrid';
import FaqList from '../../components/public/FaqList';
import ClosingCta from '../../components/public/ClosingCta';
import { CREATOR_STEPS, BRAND_STEPS } from './content';

/**
 * The dedicated public pages behind the nav (scope §4). They share the
 * lifecycle, features and FAQ components with the home page so there is one
 * copy of every claim.
 */

function PageHead({ title, lede, primary, primaryLabel }) {
  return (
    <section className="container-page pt-16 pb-12 md:pt-24">
      <h1 className="h-display text-display-md md:text-display-lg max-w-3xl">
        {title}
      </h1>
      <p className="lede mt-5">{lede}</p>
      {primary && (
        <div className="flex flex-wrap items-center gap-4 mt-8">
          <Link to={primary} className="btn-cta px-6 py-3">{primaryLabel}</Link>
          <Link to="/login" className="text-sm font-semibold text-brand-700 hover:underline">
            Already have an account? Log in
          </Link>
        </div>
      )}
    </section>
  );
}

function StepList({ steps }) {
  return (
    <section className="border-t border-line bg-bg">
      <div className="container-page section grid gap-x-14 gap-y-10 md:grid-cols-2">
        {steps.map((s) => (
          <div key={s.title}>
            <h2 className="font-display font-bold text-ink">{s.title}</h2>
            <p className="text-sm text-ink-soft mt-2 leading-relaxed max-w-prose">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ForCreatorsPage() {
  return (
    <PublicLayout>
      <PageHead
        title="Know what you are being paid, before you start filming."
        lede="Brands come to you with an actual budget, deliverables and a deadline attached. You counter until the terms work, and the money sits in escrow before the campaign starts."
        primary="/signup?role=creator"
        primaryLabel="Join as a creator"
      />
      <StepList steps={CREATOR_STEPS} />
      <LifecycleTrack />
      <FaqList limit={4} />
      <ClosingCta />
    </PublicLayout>
  );
}

export function ForBrandsPage() {
  return (
    <PublicLayout>
      <PageHead
        title="Run creator campaigns that survive an audit."
        lede="Search creators on verified audience data, send offers with real terms, and keep every counter-offer, approval and payout on one record you can point at later."
        primary="/signup?role=brand"
        primaryLabel="Join as a brand"
      />
      <StepList steps={BRAND_STEPS} />
      <LifecycleTrack />
      <FaqList limit={4} />
      <ClosingCta />
    </PublicLayout>
  );
}

export function HowItWorksPage() {
  return (
    <PublicLayout>
      <PageHead
        title="A collaboration, stage by stage."
        lede="Every Marqueiver campaign moves through the same ten stages. A stage only advances when the party responsible for it acts, and the platform will not let it skip."
      />
      <LifecycleTrack heading={false} />
      <FeatureGrid />
      <ClosingCta />
    </PublicLayout>
  );
}

export function FaqPage() {
  return (
    <PublicLayout>
      <PageHead
        title="Questions, answered plainly."
        lede="How joining works, why a connected account is required, when messaging opens, and what happens to your money at each stage."
      />
      <FaqList />
      <ClosingCta />
    </PublicLayout>
  );
}
