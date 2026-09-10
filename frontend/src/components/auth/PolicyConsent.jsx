import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Checkbox } from './AuthBits';

/**
 * Policy acceptance, on the form, before the account exists.
 *
 * Three things this has to get right, and the previous implementation got none
 * of them:
 *
 *  1. **The policies shown are the policies that bind this role.** The list is
 *     fetched from `/auth/signup/requirements?role=…`, which is the same source
 *     the server checks the submission against. A Creator sees the Creator
 *     Policy; a Brand sees the Brand Policy; neither sees the other's. That is a
 *     property of the data, not of this component remembering to filter.
 *
 *  2. **Every policy is reachable and readable before agreeing.** Each name is a
 *     real link to a real page carrying the real text. They open in a new tab so
 *     a half-filled signup form is not lost to a back button.
 *
 *  3. **The version is visible.** Acceptance is recorded against a specific
 *     version, so the version is shown rather than hidden behind the word
 *     "policies".
 *
 * One checkbox covers the full applicable set. The three named policies are the
 * ones the consent line calls out; the remaining eleven are listed in full,
 * one expand away, rather than being summarised as "and others" — a user is
 * agreeing to all of them and is entitled to see what they are.
 */
export function PolicyConsent({ policies, role, checked, onChange, invalid }) {
  const [expanded, setExpanded] = useState(false);

  const primary = policies.filter((p) => p.signupPrimary);
  const rest = policies.filter((p) => !p.signupPrimary);
  const version = policies[0]?.version;

  return (
    <div className={`rounded-xl2 border p-4 transition-colors ${
      invalid ? 'border-rose-300 bg-rose-50/40' : 'border-line bg-bg/60'}`}>
      <Checkbox id="accept-policies" checked={checked} onChange={onChange} invalid={invalid}>
        I have read and agree to the{' '}
        {primary.map((p, i) => (
          <span key={p.slug}>
            <PolicyLink policy={p} />
            {i < primary.length - 2 ? ', ' : i === primary.length - 2 ? ' and the ' : ''}
          </span>
        ))}
        {rest.length > 0 && (
          <>, and the {rest.length} other Marqueiver platform policies that apply to {
            role === 'creator' ? 'creators' : 'brands'}</>
        )}.
      </Checkbox>

      {rest.length > 0 && (
        <div className="mt-3 pl-8">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls="policy-full-list"
            className="text-xs font-medium text-brand-700 hover:underline inline-flex items-center gap-1"
          >
            {expanded ? 'Hide' : 'Show'} all {policies.length} policies
            <svg
              className={`w-3 h-3 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {expanded && (
            <ul id="policy-full-list" className="mt-2.5 grid sm:grid-cols-2 gap-x-4 gap-y-1.5 anim-rise">
              {policies.map((p) => (
                <li key={p.slug} className="text-xs">
                  <PolicyLink policy={p} muted />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {version && (
        <p className="mt-3 pl-8 text-xs text-muted">
          Version {version} · your acceptance is recorded against this version.
        </p>
      )}
    </div>
  );
}

function PolicyLink({ policy, muted = false }) {
  return (
    <Link
      to={policy.route ?? `/policies/${policy.slug}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`font-medium hover:underline underline-offset-2 ${
        muted ? 'text-ink-soft hover:text-brand-700' : 'text-brand-700'}`}
    >
      {policy.title}
      <svg className="inline-block w-3 h-3 ml-0.5 -mt-0.5 opacity-60" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        strokeLinejoin="round" aria-hidden="true">
        <path d="M7 17 17 7M9 7h8v8" />
      </svg>
      <span className="sr-only"> (opens in a new tab)</span>
    </Link>
  );
}

/** Loading state for the policy list, so the checkbox never appears unlabelled. */
export function PolicyConsentSkeleton() {
  return (
    <div className="rounded-xl2 border border-line bg-bg/60 p-4" aria-busy="true">
      <div className="flex gap-3">
        <div className="w-5 h-5 rounded-md shimmer shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3 rounded shimmer" />
          <div className="h-3 rounded shimmer w-4/5" />
        </div>
      </div>
    </div>
  );
}
