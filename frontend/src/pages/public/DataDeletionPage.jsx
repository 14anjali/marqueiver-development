import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PublicLayout } from '../../components/public/PublicChrome';
import { api } from '../../lib/api';

/**
 * The page behind the URL Marqueiver hands back to Meta's Data Deletion callback.
 *
 * Meta's requirement is that a person who asks Facebook or Instagram to delete
 * their data gets a URL and a confirmation code, and that the URL explains the
 * status of that request. This is that page.
 *
 * It is public and unauthenticated on purpose. The person arriving here has just
 * removed the app; requiring them to sign in to find out whether their deletion
 * happened would be exactly the wrong shape. The confirmation code is the only
 * credential, and the endpoint behind it returns nothing that identifies an
 * account — platform, timestamps and a status, and that is all.
 *
 * The code can also be typed in, because these links get copied into notes and
 * emails and arrive with the query string stripped more often than not.
 */

const PLATFORM_LABEL = {
  facebook: 'Facebook',
  instagram: 'Instagram',
};

const STATUS_COPY = {
  completed: {
    tone: 'done',
    title: 'Your data has been deleted',
    body: 'We removed the connection and everything we had received from this account — the '
      + 'access tokens, the synced profile details and audience numbers, and the copy shown on '
      + 'your Marqueiver profile.',
  },
  no_data_found: {
    tone: 'done',
    title: 'There was nothing to delete',
    body: 'We received your request and checked. This account was not connected to Marqueiver, '
      + 'so we held no data from it. Nothing further is needed.',
  },
  received: {
    tone: 'pending',
    title: 'Your request is being processed',
    body: 'We have your request and are working through it. Come back to this page in a few '
      + 'minutes and the status will have updated.',
  },
  failed: {
    tone: 'failed',
    title: 'Your request did not complete',
    body: 'Something went wrong on our side while processing this request. Our team can see it '
      + 'and will finish it — quote the confirmation code below if you contact us.',
  },
};

const fmt = (d) => (d
  ? new Date(d).toLocaleString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  : null);

const TONE_CLASS = {
  done: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
};

export default function DataDeletionPage() {
  const [params, setParams] = useSearchParams();
  const code = (params.get('code') || '').trim().toUpperCase();

  const [typed, setTyped] = useState('');
  const [record, setRecord] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!code) { setRecord(null); setError(null); return undefined; }

    let alive = true;
    setLoading(true);
    setError(null);

    api.dataDeletionStatus(code)
      .then(({ data }) => alive && setRecord(data))
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));

    return () => { alive = false; };
  }, [code]);

  const copy = record ? (STATUS_COPY[record.status] ?? STATUS_COPY.received) : null;

  return (
    <PublicLayout>
      <section className="container-page pt-16 pb-24 md:pt-24">
        <div className="max-w-2xl">
          <h1 className="h-display text-display-md md:text-display-lg">Data deletion request</h1>
          <p className="lede mt-5">
            When you ask Facebook or Instagram to delete the data an app holds about you, they
            tell us, and we act on it. This page shows what happened to your request.
          </p>

          {/* No code in the URL — let people type the one they were given. */}
          {!code && (
            <form
              className="card mt-10 p-6 md:p-8"
              onSubmit={(e) => {
                e.preventDefault();
                const next = typed.trim().toUpperCase();
                if (next) setParams({ code: next });
              }}
            >
              <label htmlFor="dd-code" className="field-label">
                Confirmation code
              </label>
              <p className="mt-1 text-sm text-muted">
                Facebook or Instagram showed you this code when your request was made.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  id="dd-code"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="e.g. K3M9QP2XA7BD"
                  autoComplete="off"
                  spellCheck={false}
                  className="field flex-1 font-mono uppercase tracking-wider"
                />
                <button type="submit" className="btn-brand" disabled={!typed.trim()}>
                  Check status
                </button>
              </div>
            </form>
          )}

          {loading && (
            <div className="card mt-10 p-6 md:p-8">
              <p className="text-muted">Looking up {code}…</p>
            </div>
          )}

          {/* A code that matches nothing. Deliberately says nothing about why. */}
          {!loading && code && error && (
            <div className="card mt-10 p-6 md:p-8">
              <h2 className="text-lg font-semibold">We could not find that code</h2>
              <p className="mt-3 text-muted">
                {error.status === 404
                  ? 'No deletion request matches this confirmation code. Check it for typos — '
                    + 'it is twelve characters, letters and digits.'
                  : 'We could not check the status right now. Please try again in a moment.'}
              </p>
              <button
                type="button"
                className="btn-ghost mt-5"
                onClick={() => { setParams({}); setTyped(code); }}
              >
                Enter a different code
              </button>
            </div>
          )}

          {!loading && record && copy && (
            <div className="card mt-10 p-6 md:p-8">
              <span className={`pill border ${TONE_CLASS[copy.tone]}`}>
                {record.status === 'received' ? 'In progress' : 'Request closed'}
              </span>

              <h2 className="mt-5 text-xl font-semibold md:text-2xl">{copy.title}</h2>
              <p className="mt-3 text-muted">{copy.body}</p>

              <dl className="mt-7 grid gap-4 border-t border-line pt-6 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-muted">Platform</dt>
                  <dd className="mt-1 font-medium">
                    {PLATFORM_LABEL[record.platform] ?? record.platform}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">Confirmation code</dt>
                  <dd className="mt-1 font-mono font-medium tracking-wider">
                    {record.confirmationCode}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">Requested</dt>
                  <dd className="mt-1 font-medium">{fmt(record.requestedAt) ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">Completed</dt>
                  <dd className="mt-1 font-medium">{fmt(record.completedAt) ?? 'Not yet'}</dd>
                </div>
              </dl>
            </div>
          )}

          {/*
            The honest part. People reading this page are entitled to know that
            "delete my Facebook data" is not the same request as "delete my
            Marqueiver account", and where the second one lives.
          */}
          <div className="panel mt-10 p-6 md:p-8">
            <h2 className="text-lg font-semibold">What this covers</h2>
            <p className="mt-3 text-muted">
              A request from Facebook or Instagram removes the data we received from that
              platform: the access tokens, the profile and audience details we synced, and the
              copy of them shown on your Marqueiver profile.
            </p>
            <p className="mt-3 text-muted">
              It does not close your Marqueiver account. Your collaborations, messages and payment
              records stay as they are — we are required to keep transaction records for tax and
              accounting, and deleting them because you unlinked a social account would take your
              earnings history with it.
            </p>
            <p className="mt-3 text-muted">
              To close your account entirely, sign in and use{' '}
              <Link to="/profile" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Profile → Delete account</Link>, or read the{' '}
              <Link to="/privacy" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Privacy Policy</Link> for what we keep and for
              how long.
            </p>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
