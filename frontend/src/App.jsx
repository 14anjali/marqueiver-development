import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { ToastProvider } from './lib/ui-state';

import LoginPage from './pages/LoginPage';
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

// Gate: redirect to /login when not authed.
function Protected({ children }) {
  const { isAuthed } = useAuth();
  const loc = useLocation();
  if (!isAuthed) return <Navigate to="/login" state={{ from: loc }} replace />;
  return children;
}

// Admin routes need both auth AND the admin role — a creator/brand hitting
// /admin/* is redirected to their own dashboard, not shown an error page.
function AdminProtected({ children }) {
  const { isAuthed, user } = useAuth();
  const loc = useLocation();
  if (!isAuthed) return <Navigate to="/login" state={{ from: loc }} replace />;
  if (user?.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/onboarding/influencer" element={<Protected><InfluencerOnboarding /></Protected>} />
            <Route path="/onboarding/brand" element={<Protected><BrandOnboarding /></Protected>} />
            <Route path="/onboarding/instagram" element={<Protected><InstagramCallback /></Protected>} />
            <Route path="/onboarding/facebook" element={<Protected><FacebookCallback /></Protected>} />
            <Route path="/onboarding/youtube" element={<Protected><YoutubeCallback /></Protected>} />
            <Route path="/" element={<Protected><RoleHome /></Protected>} />

            <Route path="/admin" element={<AdminProtected><AdminDashboard /></AdminProtected>} />
            <Route path="/admin/verifications" element={<AdminProtected><AdminVerifications /></AdminProtected>} />
            <Route path="/admin/deals" element={<AdminProtected><AdminDeals /></AdminProtected>} />
            <Route path="/admin/users" element={<AdminProtected><AdminUsers /></AdminProtected>} />
            <Route path="/admin/reviews" element={<AdminProtected><AdminReviews /></AdminProtected>} />
            <Route path="/admin/wallets" element={<AdminProtected><AdminWallets /></AdminProtected>} />
            <Route path="/admin/team" element={<AdminProtected><AdminTeam /></AdminProtected>} />
            <Route path="/admin/audit" element={<AdminProtected><AdminAudit /></AdminProtected>} />

            <Route path="/dashboard" element={<Protected><DashboardPage /></Protected>} />
            <Route path="/discover" element={<Protected><CreatorsPage /></Protected>} />
            <Route path="/creator/:id" element={<Protected><CreatorProfilePage /></Protected>} />
            <Route path="/brand/:id" element={<Protected><BrandProfilePage /></Protected>} />
            <Route path="/brand" element={<Protected><BrandProfilePage /></Protected>} />
            <Route path="/campaigns" element={<Protected><CampaignsPage /></Protected>} />
            <Route path="/deals" element={<Protected><DealsPage /></Protected>} />
            <Route path="/deals/:id" element={<Protected><DealDetailPage /></Protected>} />
            <Route path="/messages" element={<Protected><MessagesPage /></Protected>} />
            <Route path="/notifications" element={<Protected><NotificationsPage /></Protected>} />
            <Route path="/profile" element={<Protected><ProfilePage /></Protected>} />
            <Route path="/portfolio" element={<Protected><PortfolioPage /></Protected>} />
            <Route path="/analytics" element={<Protected><AnalyticsPage /></Protected>} />
            <Route path="/earnings" element={<Protected><EarningsPage /></Protected>} />
            <Route path="/saved" element={<Protected><SavedCreatorsPage /></Protected>} />
            <Route path="/verifications" element={<Protected><VerificationsPage /></Protected>} />

            <Route path="*" element={<Protected><RoleHome /></Protected>} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

// Landing redirect that respects role — admins go to the admin dashboard,
// everyone else to creator discovery, instead of a hardcoded /discover that
// would 404-loop an admin (who has no /discover access pattern in their nav).
function RoleHome() {
  const { user } = useAuth();
  return <Navigate to={user?.role === 'admin' ? '/admin' : '/discover'} replace />;
}
