import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LoadingBlock } from '../lib/ui-state';

/**
 * Landing page the backend redirects to after Instagram OAuth
 * (/onboarding/instagram?ig=connected|error). It forwards the result into the
 * influencer onboarding flow, which reads the same query params.
 */
export default function InstagramCallback() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  useEffect(() => {
    const q = params.toString();
    nav(`/onboarding/influencer?${q}`, { replace: true });
  }, [params, nav]);
  return <LoadingBlock label="Finishing Instagram connection…" />;
}
