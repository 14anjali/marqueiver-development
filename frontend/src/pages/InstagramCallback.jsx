import OAuthHandoff from '../components/OAuthHandoff';

/**
 * Landing page the backend redirects to after Instagram OAuth
 * (/onboarding/instagram?ig=connected|error). It forwards the result into the
 * influencer onboarding flow, which reads the same query params.
 *
 * The screen itself is shared with the Facebook and YouTube callbacks — the
 * three were identical apart from a label and a destination, so the behaviour
 * lives in OAuthHandoff and these declare only what differs.
 */
export default function InstagramCallback() {
  return <OAuthHandoff platform="instagram" to="/onboarding/influencer" />;
}
