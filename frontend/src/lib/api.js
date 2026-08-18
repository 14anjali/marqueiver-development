// Marqueiver API client — talks to the backend given by VITE_API_URL.
// In dev, Vite also proxies /api and /health, so relative paths work too.

const BASE = import.meta.env.VITE_API_URL || '';

const TOKEN_KEY = 'mq_access';
const REFRESH_KEY = 'mq_refresh';
const USER_KEY = 'mq_user';

export const auth = {
  get token() { return localStorage.getItem(TOKEN_KEY) || ''; },
  get refresh() { return localStorage.getItem(REFRESH_KEY) || ''; },
  get user() { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } },
  save({ accessToken, refreshToken, user }) {
    if (accessToken) localStorage.setItem(TOKEN_KEY, accessToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() { [TOKEN_KEY, REFRESH_KEY, USER_KEY].forEach((k) => localStorage.removeItem(k)); },
  get isAuthed() { return !!this.token; },
};

export class ApiError extends Error {
  constructor(message, status, detail) { super(message); this.status = status; this.detail = detail; }
}

async function req(path, { method = 'GET', body, noAuth = false, raw = false } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (!noAuth && auth.token) headers.Authorization = `Bearer ${auth.token}`;

  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new ApiError('Network error — is the backend running on ' + (BASE || 'the proxy') + '?', 0);
  }

  if (raw) return res;

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    const msg = json?.error?.message || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, json?.error);
  }
  return { data: json.data, meta: json.meta };
}

export const api = {
  health: () => req('/health', { noAuth: true }),

  requestOtp: (phone, purpose = 'login') =>
    req('/api/auth/otp/request', { method: 'POST', noAuth: true, body: { phone, purpose } }),
  verifyOtp: (phone, code, role) =>
    req('/api/auth/otp/verify', { method: 'POST', noAuth: true, body: { phone, code, role } }),
  // SRS §5 email OTP (FR-7)
  sendEmailOtp: (email, purpose = 'login') =>
    req('/api/auth/send-email-otp', { method: 'POST', noAuth: true, body: { email, purpose } }),
  verifyEmailOtp: (email, code, role) =>
    req('/api/auth/verify-email-otp', { method: 'POST', noAuth: true, body: { email, code, role } }),
  me: () => req('/api/auth/me'),

  // ---- Instagram (SRS FR-4/FR-5) ----
  instagramAuthUrl: () => req(`/api/auth/instagram?token=${encodeURIComponent(auth.token)}`),
  instagramProfile: () => req('/api/instagram/profile'),
  instagramSync: () => req('/api/instagram/sync', { method: 'POST' }),

  // ---- Facebook (optional connect, Profile page only) ----
  facebookAuthUrl: () => req(`/api/auth/facebook?token=${encodeURIComponent(auth.token)}`),
  facebookProfile: () => req('/api/facebook/profile'),
  facebookSync: () => req('/api/facebook/sync', { method: 'POST' }),

  // ---- YouTube (optional connect, Profile page only) ----
  youtubeAuthUrl: () => req(`/api/auth/youtube?token=${encodeURIComponent(auth.token)}`),
  youtubeProfile: () => req('/api/youtube/profile'),
  youtubeSync: () => req('/api/youtube/sync', { method: 'POST' }),
  instagramDisconnect: () =>
  req('/api/instagram/disconnect', { method: 'DELETE' }),

  myProfile: () => req('/api/users/me/profile'),
  updateCreator: (payload) => req('/api/users/me/creator', { method: 'PATCH', body: payload }),
  updateBrand: (payload) => req('/api/users/me/brand', { method: 'PATCH', body: payload }),
  logoUploadUrl: (fileName, contentType) => req('/api/users/me/logo-upload-url', { method: 'POST', body: { fileName, contentType, purpose: 'brand-logo' } }),
  connectSocial: (platform, handle) => req('/api/users/me/socials', { method: 'POST', body: { platform, handle } }),
  runAiAnalysis: () => req('/api/users/me/ai-analysis', { method: 'POST' }),
  completeOnboarding: () => req('/api/users/me/complete-onboarding', { method: 'POST' }),
  saveOnboardingStep: (step) => req('/api/users/me/onboarding-step', { method: 'PATCH', body: { step } }),

  // Portfolio
  addPortfolioItem: (payload) => req('/api/users/me/portfolio', { method: 'POST', body: payload }),
  deletePortfolioItem: (itemId) => req(`/api/users/me/portfolio/${itemId}`, { method: 'DELETE' }),
  portfolioUploadUrl: (fileName, contentType) => req('/api/users/me/logo-upload-url', { method: 'POST', body: { fileName, contentType, purpose: 'portfolio' } }),
  verificationUploadUrl: (fileName, contentType) => req('/api/users/me/logo-upload-url', { method: 'POST', body: { fileName, contentType, purpose: 'verification' } }),
  submitVerification: (kind, documents) => req('/api/verifications', { method: 'POST', body: { kind, documents } }),
  myVerifications: () => req('/api/verifications'),

  // Analytics + Media Kit
  analytics: () => req('/api/users/me/analytics'),
  // Downloads via an authenticated fetch (not a bare <a href>) so the JWT goes
  // in the Authorization header rather than a URL — a raw link can't carry
  // the auth header, and adding query-token support to the auth middleware
  // would leak tokens into server logs / browser history for every request.
  downloadMediaKit: async (filename = 'media-kit.pdf') => {
    const res = await req('/api/users/me/media-kit', { raw: true });
    if (!res.ok) throw new ApiError('Could not generate media kit', res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  },

  // Saved / bookmarked creators
  saveCreator: (creatorId) => req(`/api/discovery/creators/${creatorId}/save`, { method: 'POST' }),
  unsaveCreator: (creatorId) => req(`/api/discovery/creators/${creatorId}/save`, { method: 'DELETE' }),
  listSavedCreators: () => req('/api/discovery/creators/saved'),

  searchCreators: (params = {}) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null));
    const q = new URLSearchParams(clean).toString();
    return req(`/api/discovery/creators${q ? `?${q}` : ''}`);
  },
  downloadCreatorsCsv: async (params = {}, filename = 'creators.csv') => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null));
    const q = new URLSearchParams(clean).toString();
    const res = await req(`/api/discovery/creators/export${q ? `?${q}` : ''}`, { raw: true });
    if (!res.ok) throw new ApiError('Export failed', res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  },
  getCreator: (id) => req(`/api/discovery/creators/${id}`),
  searchBrands: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req(`/api/discovery/brands${q ? `?${q}` : ''}`);
  },
  getBrand: (id) => req(`/api/discovery/brands/${id}`),

  createDeal: (payload) => req('/api/deals', { method: 'POST', body: payload }),
  createPaymentSession: (dealId) => req(`/api/deals/${dealId}/payment-session`, { method: 'POST' }),
  myDeals: (state) => req(`/api/deals${state ? `?state=${state}` : ''}`),
  getDeal: (id) => req(`/api/deals/${id}`),
  transitionDeal: (id, payload) => req(`/api/deals/${id}/transition`, { method: 'POST', body: payload }),
  submitWork: (id, payload) => req(`/api/deals/${id}/submit`, { method: 'POST', body: payload }),

  listMessages: (dealId) => req(`/api/messages/${dealId}`),
  listMessageThreads: () => req('/api/messages/threads'),
  markMessagesRead: (dealId) => req(`/api/messages/${dealId}/read`, { method: 'POST' }),
  sendMessage: (dealId, body) => req(`/api/messages/${dealId}`, { method: 'POST', body: { body } }),

  transactions: () => req('/api/payments/transactions'),
  earnings: () => req('/api/payments/earnings'),

  createReview: (dealId, payload) => req(`/api/reviews/deal/${dealId}`, { method: 'POST', body: payload }),
  reviewsForUser: (userId) => req(`/api/reviews/user/${userId}`),
  notifications: (unread = false) => req(`/api/notifications${unread ? '?unread=true' : ''}`),
  markNotificationsRead: (ids) => req('/api/notifications/read', { method: 'POST', body: { ids } }),
  compatibility: (creatorId) => req(`/api/ai/compatibility/${creatorId}`),

  // Campaigns
  createCampaign: (payload) => req('/api/campaigns', { method: 'POST', body: payload }),
  listCampaigns: () => req('/api/campaigns'),
  listCampaignsForBrand: (brandUserId) => req(`/api/campaigns?brand=${brandUserId}`),
  getCampaign: (id) => req(`/api/campaigns/${id}`),
  updateCampaign: (id, payload) => req(`/api/campaigns/${id}`, { method: 'PATCH', body: payload }),
  applyToCampaign: (id) => req(`/api/campaigns/${id}/apply`, { method: 'POST' }),
  listCampaignApplicants: (id) => req(`/api/campaigns/${id}/applicants`),
  decideApplicant: (id, creatorId, status) => req(`/api/campaigns/${id}/applicants/${creatorId}`, { method: 'PATCH', body: { status } }),

  // Wallet (internal ledger; real money only via Cashfree at withdrawal)
  getWallet: () => req('/api/wallet'),
  getWalletLedger: () => req('/api/wallet/ledger'),
  setPayoutMethod: (payload) => req('/api/wallet/payout-method', { method: 'POST', body: payload }),
  withdraw: (amount) => req('/api/wallet/withdraw', { method: 'POST', body: { amount } }),

  // Admin
  adminOverview: () => req('/api/admin/overview'),
  adminAnalytics: () => req('/api/admin/analytics'),
  adminWallets: () => req('/api/admin/wallets'),
  adminListUsers: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req(`/api/admin/users${q ? `?${q}` : ''}`);
  },
  adminVerifications: (status = 'pending') => req(`/api/admin/verifications?status=${status}`),
  adminDecideVerification: (id, decision, note) => req(`/api/admin/verifications/${id}`, { method: 'POST', body: { decision, note } }),
  adminDeals: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req(`/api/admin/deals${q ? `?${q}` : ''}`);
  },
  adminResolveDeal: (id, to, note) => req(`/api/admin/deals/${id}/resolve`, { method: 'POST', body: { to, note } }),
  adminSuspendUser: (id, suspend, reason) => req(`/api/admin/users/${id}/suspend`, { method: 'POST', body: { suspend, reason } }),
  adminModerateReview: (id, hidden) => req(`/api/admin/reviews/${id}/moderate`, { method: 'POST', body: { hidden } }),
  adminListReviews: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req(`/api/admin/reviews${q ? `?${q}` : ''}`);
  },
  adminInviteTeam: (phone, adminLevel) => req('/api/admin/team/invite', { method: 'POST', body: { phone, adminLevel } }),
  adminAuditLog: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req(`/api/admin/audit${q ? `?${q}` : ''}`);
  },
  adminExportCsv: async (kind, filename) => {
    const res = await req(`/api/admin/export/${kind}`, { raw: true });
    if (!res.ok) throw new ApiError('Export failed', res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || `${kind}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  },
};
