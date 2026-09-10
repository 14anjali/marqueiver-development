import OAuthHandoff from '../components/OAuthHandoff';

/**
 * Landing page the backend redirects to after Facebook OAuth
 * (/onboarding/facebook?fb=connected|error — the path is fixed on the backend
 * regardless of where the connect was started from). Unlike Instagram,
 * Facebook connect is optional and lives on the Profile page, not onboarding,
 * so this forwards there instead.
 */
export default function FacebookCallback() {
  return <OAuthHandoff platform="facebook" to="/profile" />;
}
