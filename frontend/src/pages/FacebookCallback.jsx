import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LoadingBlock } from '../lib/ui-state';

/**
 * Landing page the backend redirects to after Facebook OAuth
 * (/onboarding/facebook?fb=connected|error — the path is fixed on the
 * backend regardless of where the connect was started from). Unlike
 * Instagram, Facebook connect is optional and lives on the Profile page, not
 * onboarding — so this forwards there instead.
 */
export default function FacebookCallback() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  useEffect(() => {
    const q = params.toString();
    nav(`/profile?${q}`, { replace: true });
  }, [params, nav]);
  return <LoadingBlock label="Finishing Facebook connection…" />;
}
