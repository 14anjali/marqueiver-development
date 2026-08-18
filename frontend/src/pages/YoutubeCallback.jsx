import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LoadingBlock } from '../lib/ui-state';

/**
 * Landing page the backend redirects to only on a FAILED YouTube OAuth
 * (/onboarding/youtube?yt=error — success goes straight to /profile?yt=connected
 * since YouTube connect is optional and lives on the Profile page, same as
 * Facebook). This just forwards the error state there too, for one
 * consistent handling point regardless of outcome.
 */
export default function YoutubeCallback() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  useEffect(() => {
    const q = params.toString();
    nav(`/profile?${q}`, { replace: true });
  }, [params, nav]);
  return <LoadingBlock label="Finishing YouTube connection…" />;
}
