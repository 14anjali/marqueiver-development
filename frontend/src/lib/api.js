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

  /* ── Authentication ───────────────────────────────────────────────────────
   *
   * Three methods (email, WhatsApp OTP, Google) across two flows, and the
   * shape below is the point: verification is its own step that yields a
   * `verificationToken`, and only then does the client call `login` or
   * `signup`.
   *
   * There is deliberately no way to send a role to `login`. The account's role
   * lives in the database and comes back on the session; the client cannot
   * propose one, so it cannot get one wrong.
   */
  authConfig: () => req('/api/auth/config', { noAuth: true }),

  sendWhatsappOtp: (phone, purpose = 'login') =>
    req('/api/auth/otp/whatsapp/send', { method: 'POST', noAuth: true, body: { phone, purpose } }),
  resendWhatsappOtp: (phone, purpose = 'login') =>
    req('/api/auth/otp/whatsapp/resend', { method: 'POST', noAuth: true, body: { phone, purpose } }),
  sendEmailOtp: (email, purpose = 'login') =>
    req('/api/auth/otp/email/send', { method: 'POST', noAuth: true, body: { email, purpose } }),
  resendEmailOtp: (email, purpose = 'login') =>
    req('/api/auth/otp/email/resend', { method: 'POST', noAuth: true, body: { email, purpose } }),

  /** Returns { verificationToken, accountExists, role } — a token, not a session. */
  verifyOtp: (channel, identifier, code) =>
    req('/api/auth/otp/verify', { method: 'POST', noAuth: true, body: { channel, identifier, code } }),

  /** Google Identity Services: an id_token the server verifies against Google. */
  verifyGoogleIdToken: (idToken) =>
    req('/api/auth/google/verify', { method: 'POST', noAuth: true, body: { idToken } }),
  /** Redirect flow — the client secret never reaches the browser. */
  googleStartUrl: (intent, role) => {
    const q = new URLSearchParams({ intent, ...(role ? { role } : {}) });
    return `${BASE}/api/auth/google/start?${q}`;
  },

  /** The policies this role must accept, resolved server-side. */
  signupRequirements: (role) =>
    req(`/api/auth/signup/requirements?role=${encodeURIComponent(role)}`, { noAuth: true }),

  signup: (payload) => req('/api/auth/signup', { method: 'POST', noAuth: true, body: payload }),
  login: (verificationToken) =>
    req('/api/auth/login', { method: 'POST', noAuth: true, body: { verificationToken } }),

  me: () => req('/api/auth/me'),
  /** Attach a second verified identity (Policy 13.1 mobile + email). */
  linkIdentity: (verificationToken) =>
    req('/api/auth/link', { method: 'POST', body: { verificationToken } }),
  /** Policy 1.14 re-consent after a new version is published. */
  acceptOutstandingPolicies: (acceptedPolicies, context) =>
    req('/api/auth/policies/accept', { method: 'POST', body: { acceptedPolicies, context } }),

  // ---- Instagram (SRS FR-4/FR-5) ----
  instagramAuthUrl: () => req('/api/auth/instagram'),
  instagramProfile: () => req('/api/instagram/profile'),
  instagramSync: () => req('/api/instagram/sync', { method: 'POST' }),

  // ---- Facebook Pages ----
  facebookAuthUrl: () => req('/api/auth/facebook'),
  facebookProfile: () => req('/api/facebook/profile'),
  facebookSync: () => req('/api/facebook/sync', { method: 'POST' }),

  /**
   * The Pages this person can act on, read live from Facebook.
   *
   * Page access tokens are stripped server-side and never reach the browser —
   * a Page token in frontend state can be read straight out of devtools, and it
   * grants publishing rights on that Page. Each entry carries `canPublish` and
   * `canModerate`, derived from Facebook's own `tasks`, so the UI can disable
   * an action the person's Page role does not allow instead of letting them
   * write a post and fail at submit.
   */
  facebookPages: () => req('/api/facebook/pages'),
  selectFacebookPage: (pageId) =>
    req('/api/facebook/pages/select', { method: 'POST', body: { pageId } }),

  facebookPosts: (limit = 25) => req(`/api/facebook/posts?limit=${limit}`),
  publishFacebookPost: ({ message, link }) =>
    req('/api/facebook/posts', { method: 'POST', body: { message, link } }),
  deleteFacebookPost: (postId) =>
    req(`/api/facebook/posts/${encodeURIComponent(postId)}`, { method: 'DELETE' }),

  facebookComments: (postId, limit = 50) =>
    req(`/api/facebook/posts/${encodeURIComponent(postId)}/comments?limit=${limit}`),
  replyToFacebookComment: (commentId, message) =>
    req(`/api/facebook/comments/${encodeURIComponent(commentId)}/reply`, { method: 'POST', body: { message } }),
  hideFacebookComment: (commentId, hidden = true) =>
    req(`/api/facebook/comments/${encodeURIComponent(commentId)}/hide`, { method: 'POST', body: { hidden } }),
  deleteFacebookComment: (commentId) =>
    req(`/api/facebook/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' }),

  // ---- YouTube (optional connect, Profile page only) ----
  youtubeAuthUrl: () => req('/api/auth/youtube'),
  youtubeProfile: () => req('/api/youtube/profile'),
  youtubeSync: () => req('/api/youtube/sync', { method: 'POST' }),
  instagramDisconnect: () =>
  req('/api/instagram/disconnect', { method: 'DELETE' }),
  // A73 — disconnect parity across all three platforms.
  disconnectYoutube: () => req('/api/youtube/disconnect', { method: 'DELETE' }),
  disconnectFacebook: () => req('/api/facebook/disconnect', { method: 'DELETE' }),

  /**
   * Status of a Meta data deletion request, looked up by the confirmation code
   * we returned to Facebook or Instagram. `noAuth` because the person following
   * this link has just removed the app and may have no way to sign in — the
   * code is the only credential, and the endpoint returns nothing identifying.
   */
  dataDeletionStatus: (code) =>
    req(`/api/data-deletion/status/${encodeURIComponent(code)}`, { noAuth: true }),

  myProfile: () => req('/api/users/me/profile'),
  /**
   * Everything the onboarding screens need in one call: what signup already
   * captured, what is still missing, and which platforms are connected. The
   * server owns this so the UI never re-asks for a value it already holds.
   */
  onboardingState: () => req('/api/users/me/onboarding'),
  avatarUploadUrl: (fileName, contentType) =>
    req('/api/users/me/logo-upload-url', { method: 'POST', body: { fileName, contentType, purpose: 'avatar' } }),
  updateCreator: (payload) => req('/api/users/me/creator', { method: 'PATCH', body: payload }),
  updateBrand: (payload) => req('/api/users/me/brand', { method: 'PATCH', body: payload }),
  logoUploadUrl: (fileName, contentType) => req('/api/users/me/logo-upload-url', { method: 'POST', body: { fileName, contentType, purpose: 'brand-logo' } }),
  connectSocial: (platform, handle) => req('/api/users/me/socials', { method: 'POST', body: { platform, handle } }),
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

  // Policy 28 — the consequence must be shown before the user confirms.
  previewCancellation: (id) => req(`/api/deals/${id}/cancellation-preview`),
  cancelDeal: (id, reason) => req(`/api/deals/${id}/cancel`, { method: 'POST', body: { reason } }),
  // Policy 5.4 — enforced server-side; diverts to Resolution when exhausted.
  requestRevision: (id, note) => req(`/api/deals/${id}/request-revision`, { method: 'POST', body: { note } }),
  // Policy 15 — must be confirmed before deliverables can be submitted.
  confirmDisclosure: (id, payload) => req(`/api/deals/${id}/disclosure`, { method: 'POST', body: payload }),

  // Policy 24 — versioned policy acceptance.
  // `role` narrows the list to the policies that bind that role, so a Creator is
  // never shown the Brand Policy as something they must accept.
  listPolicies: (role) => req(`/api/policies${role ? `?role=${encodeURIComponent(role)}` : ''}`, { noAuth: true }),
  // Accepts a slug (`terms-of-use`) or a short public route (`terms`).
  getPolicy: (slugOrRoute, version) =>
    req(`/api/policies/${slugOrRoute}${version ? `?version=${encodeURIComponent(version)}` : ''}`, { noAuth: true }),
  // Policy 1.3 — 18+ declaration, verified server-side.
  declareAge: (dob) => req('/api/users/me/declare-age', { method: 'POST', body: { dob } }),
  pendingPolicies: () => req('/api/policies/me/pending'),
  acceptPolicies: (slugs, context) => req('/api/policies/accept', { method: 'POST', body: { slugs, context } }),

  // Policy 3.3 — publish/unpublish the profile from discovery.
  setProfileVisibility: (isPublished) => req('/api/users/me/visibility', { method: 'PATCH', body: { isPublished } }),
  // Policy 3.2/13.2 — declared figures, kept apart from verified ones.
  setSelfReportedMetrics: (payload) => req('/api/users/me/self-reported-metrics', { method: 'PUT', body: payload }),
  // Account deletion — deactivation + anonymisation.
  deleteAccount: (reason) => req('/api/users/me', { method: 'DELETE', body: { confirm: 'DELETE', reason } }),

  // Structured negotiation (scope §11/§12) — offers are versioned records.
  createOffer: (dealId, terms) => req(`/api/deals/${dealId}/offers`, { method: 'POST', body: terms }),
  acceptOffer: (dealId, offerId) => req(`/api/deals/${dealId}/offers/${offerId}/accept`, { method: 'POST' }),
  rejectOffer: (dealId, offerId, note) => req(`/api/deals/${dealId}/offers/${offerId}/reject`, { method: 'POST', body: { note } }),
  // Offers cannot be withdrawn (§4). Terms need both parties to confirm (§5).
  confirmTerms: (dealId) => req(`/api/deals/${dealId}/confirm-terms`, { method: 'POST' }),
  rejectDeal: (dealId, note) => req(`/api/deals/${dealId}/reject`, { method: 'POST', body: { note } }),

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

  // Campaigns
  createCampaign: (payload) => req('/api/campaigns', { method: 'POST', body: payload }),
  listCampaigns: () => req('/api/campaigns'),
  listCampaignsForBrand: (brandUserId) => req(`/api/campaigns?brand=${brandUserId}`),
  getCampaign: (id) => req(`/api/campaigns/${id}`),
  updateCampaign: (id, payload) => req(`/api/campaigns/${id}`, { method: 'PATCH', body: payload }),
  applyToCampaign: (id) => req(`/api/campaigns/${id}/apply`, { method: 'POST' }),
  listCampaignApplicants: (id) => req(`/api/campaigns/${id}/applicants`),
  // §10 — campaigns this creator has applied to, with status from the server.
  listMyApplications: () => req('/api/campaigns/applied'),
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