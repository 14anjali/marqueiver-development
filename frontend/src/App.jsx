import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { ToastProvider, LoadingBlock } from './lib/ui-state';

import LoginPage from './pages/auth/LoginPage';
import SignupPage from './pages/auth/SignupPage';
import GoogleCallback from './pages/auth/GoogleCallback';
import {
  AgeDeclarationPage, PolicyAcceptancePage, VerifyChannelPage, RestrictedAccountPage,
} from './pages/auth/CompleteAccount';

import HomePage from './pages/public/HomePage';
import { ForCreatorsPage, ForBrandsPage, HowItWorksPage, FaqPage } from './pages/public/RolePages';
import { PolicyIndexPage, PolicyDetailPage } from './pages/public/PolicyPages';
import DataDeletionPage from './pages/public/DataDeletionPage';
import InfluencerOnboarding from './pages/InfluencerOnboarding';
import BrandOnboarding from './pages/BrandOnboarding';
import InstagramCallback from './pages/InstagramCallback';
import FacebookCallback from './pages/FacebookCallback';
import YoutubeCallback from './pages/YoutubeCallback';
import DashboardPage from './pages/DashboardPage';
import CreatorsPage from './pages/CreatorsPage';
import CreatorProfilePage from './pages/CreatorProfilePage';
import BrandProfilePage from './pages/BrandProfilePage';
import CampaignsPage from './pages/CampaignsPage';
import DealsPage from './pages/DealsPage';
import DealDetailPage from './pages/DealDetailPage';
import MessagesPage from './pages/MessagesPage';
import NotificationsPage from './pages/NotificationsPage';
import ProfilePage from './pages/ProfilePage';
import PortfolioPage from './pages/PortfolioPage';
import AnalyticsPage from './pages/AnalyticsPage';
import EarningsPage from './pages/EarningsPage';
import SavedCreatorsPage from './pages/SavedCreatorsPage';
import VerificationsPage from './pages/VerificationsPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminVerifications from './pages/admin/AdminVerifications';
import AdminDeals from './pages/admin/AdminDeals';
import AdminUsers from './pages/admin/AdminUsers';
import AdminReviews from './pages/admin/AdminReviews';
import AdminWallets from './pages/admin/AdminWallets';
import AdminTeam from './pages/admin/AdminTeam';
import AdminAudit from './pages/admin/AdminAudit';

/**
 * Route guards.
 *
 * The change from the previous version is where authority lives. These used to
 * read `user.role` out of localStorage, which meant the product a person saw was
 * decided by a value the browser owned. Now `useAuth()` is hydrated from
 * `/auth/me` on every load, and `next` — the step the account is actually up to —
 * is computed by the server from role, age declaration, policy acceptance,
 * verification and enforcement state.
 *
 * The backend enforces authorisation on every request regardless; none of this
 * is a security boundary. What it buys is that the UI and the API always agree,
 * so a user is never shown a page whose data the API will refuse to return.
 */

/** Signed in at all. Waits for `/auth/me` rather than flashing the login page. */
function Protected({ children }) {
  const { isAuthed, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <LoadingBlock label="Loading your account…" />;
  if (!isAuthed) return <Navigate to="/login" state={{ from: loc }} replace />;
  return children;
}

/**
 * Signed in **and** finished with everything the platform requires first.
 *
 * A user with an outstanding policy version, an unverified email or an
 * incomplete onboarding is sent to the screen that clears it. Previously the
 * backend blocked these with an error code and the frontend had no screen to
 * send anyone to, so the user was stuck holding a 403.
 */
function Ready({ children }) {
  const { isAuthed, ready, next } = useAuth();
  const loc = useLocation();

  if (!ready) return <LoadingBlock label="Loading your account…" />;
  if (!isAuthed) return <Navigate to="/login" state={{ from: loc }} replace />;

  const blocking = next && !['dashboard', 'admin'].includes(next.step);
  if (blocking && next.path !== loc.pathname) {
    return <Navigate to={next.path} replace />;
  }
  return children;
}

/** Admin-only. A creator or brand landing here goes to their own dashboard. */
function AdminProtected({ children }) {
  const { isAuthed, ready, user } = useAuth();
  const loc = useLocation();
  if (!ready) return <LoadingBlock label="Loading your account…" />;
  if (!isAuthed) return <Navigate to="/login" state={{ from: loc }} replace />;
  if (user?.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
}

/**
 * Role-scoped routes (scope §10). A creator hitting a brand-only page goes to
 * their own dashboard rather than being shown a directory they may not browse.
 * The role comes from the server-hydrated session, not from storage.
 */
function RoleRoute({ allow, children }) {
  const { user } = useAuth();
  return (
    <Ready>
      {user?.role === 'admin' || allow.includes(user?.role)
        ? children
        : <Navigate to="/dashboard" replace />}
    </Ready>
  );
}

/** Already signed in? An auth page should not trap you on itself. */
function GuestOnly({ children }) {
  const { isAuthed, ready, next } = useAuth();
  if (!ready) return <LoadingBlock label="Loading…" />;
  if (isAuthed) return <Navigate to={next?.path ?? '/dashboard'} replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            {/* Public marketing site (scope §3). */}
            <Route path="/" element={<HomePage />} />
            <Route path="/how-it-works" element={<HowItWorksPage />} />
            <Route path="/for-creators" element={<ForCreatorsPage />} />
            <Route path="/for-brands" element={<ForBrandsPage />} />
            <Route path="/faq" element={<FaqPage />} />

            {/* Policy 24 — real, public, versioned policy pages. The four named
                on the signup consent line get short, memorable URLs; every
                policy is also addressable under /policies/:slug. */}
            <Route path="/policies" element={<PolicyIndexPage />} />
            <Route path="/policies/:slug" element={<PolicyDetailPage />} />
            <Route path="/terms" element={<PolicyDetailPage route="terms" />} />
            <Route path="/privacy" element={<PolicyDetailPage route="privacy" />} />
            <Route path="/creator-policy" element={<PolicyDetailPage route="creator-policy" />} />
            <Route path="/brand-policy" element={<PolicyDetailPage route="brand-policy" />} />

            {/* The URL Marqueiver returns to Meta's Data Deletion callback.
                Public and unauthenticated by necessity — whoever follows this
                link has just removed the app and may not be able to sign in. */}
            <Route path="/data-deletion" element={<DataDeletionPage />} />

            {/* Authentication. */}
            <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
            <Route path="/signup" element={<GuestOnly><SignupPage /></GuestOnly>} />
            <Route path="/auth/google/callback" element={<GoogleCallback />} />

            {/* Compliance steps between "signed in" and "allowed to work".
                Reached because the server said so, never guessed at here. */}
            <Route path="/onboarding/age" element={<Protected><AgeDeclarationPage /></Protected>} />
            <Route path="/onboarding/policies" element={<Protected><PolicyAcceptancePage /></Protected>} />
            <Route path="/onboarding/verify-phone" element={<Protected><VerifyChannelPage channel="phone" /></Protected>} />
            <Route path="/onboarding/verify-email" element={<Protected><VerifyChannelPage channel="email" /></Protected>} />
            <Route path="/account/restricted" element={<Protected><RestrictedAccountPage /></Protected>} />

            {/* Role-specific onboarding. Protected, not Ready — this *is* one of
                the steps Ready would otherwise redirect to. */}
            <Route path="/onboarding/influencer" element={<Protected><InfluencerOnboarding /></Protected>} />
            <Route path="/onboarding/brand" element={<Protected><BrandOnboarding /></Protected>} />
            <Route path="/onboarding/instagram" element={<Protected><InstagramCallback /></Protected>} />
            <Route path="/onboarding/facebook" element={<Protected><FacebookCallback /></Protected>} />
            <Route path="/onboarding/youtube" element={<Protected><YoutubeCallback /></Protected>} />

            <Route path="/admin" element={<AdminProtected><AdminDashboard /></AdminProtected>} />
            <Route path="/admin/verifications" element={<AdminProtected><AdminVerifications /></AdminProtected>} />
            <Route path="/admin/deals" element={<AdminProtected><AdminDeals /></AdminProtected>} />
            <Route path="/admin/users" element={<AdminProtected><AdminUsers /></AdminProtected>} />
            <Route path="/admin/reviews" element={<AdminProtected><AdminReviews /></AdminProtected>} />
            <Route path="/admin/wallets" element={<AdminProtected><AdminWallets /></AdminProtected>} />
            <Route path="/admin/team" element={<AdminProtected><AdminTeam /></AdminProtected>} />
            <Route path="/admin/audit" element={<AdminProtected><AdminAudit /></AdminProtected>} />

            <Route path="/dashboard" element={<Ready><DashboardPage /></Ready>} />
            <Route path="/discover" element={<RoleRoute allow={['brand']}><CreatorsPage /></RoleRoute>} />
            <Route path="/creator/:id" element={<Ready><CreatorProfilePage /></Ready>} />
            <Route path="/brand/:id" element={<Ready><BrandProfilePage /></Ready>} />
            <Route path="/brand" element={<Ready><BrandProfilePage /></Ready>} />
            <Route path="/campaigns" element={<Ready><CampaignsPage /></Ready>} />
            <Route path="/deals" element={<Ready><DealsPage /></Ready>} />
            <Route path="/deals/:id" element={<Ready><DealDetailPage /></Ready>} />
            <Route path="/messages" element={<Ready><MessagesPage /></Ready>} />
            <Route path="/notifications" element={<Ready><NotificationsPage /></Ready>} />
            {/* Profile and verifications stay on Protected: they are where a user
                fixes the very things Ready blocks on. */}
            <Route path="/profile" element={<Protected><ProfilePage /></Protected>} />
            <Route path="/verifications" element={<Protected><VerificationsPage /></Protected>} />
            <Route path="/portfolio" element={<Ready><PortfolioPage /></Ready>} />
            <Route path="/analytics" element={<Ready><AnalyticsPage /></Ready>} />
            <Route path="/earnings" element={<Ready><EarningsPage /></Ready>} />
            <Route path="/saved" element={<RoleRoute allow={['brand']}><SavedCreatorsPage /></RoleRoute>} />

            {/* Signed-in landing target, routed by the server's answer. */}
            <Route path="/app" element={<Protected><RoleHome /></Protected>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

/** Landing redirect that follows the server's computed destination. */
function RoleHome() {
  const { next, user } = useAuth();
  return <Navigate to={next?.path ?? (user?.role === 'admin' ? '/admin' : '/dashboard')} replace />;
}
