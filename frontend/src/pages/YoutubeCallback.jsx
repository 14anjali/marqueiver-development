import OAuthHandoff from '../components/OAuthHandoff';

/**
 * Landing page the backend redirects to only on a FAILED YouTube OAuth
 * (/onboarding/youtube?yt=error — success goes straight to /profile?yt=connected
 * since YouTube connect is optional and lives on the Profile page, same as
 * Facebook). This forwards the error state there too, so there is one handling
 * point regardless of outcome.
 */
export default function YoutubeCallback() {
  return <OAuthHandoff platform="youtube" to="/profile" />;
}
