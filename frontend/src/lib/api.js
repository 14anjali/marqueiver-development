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

/**
 * Renew the access token, at most once at a time.
 *
 * The access token lives 15 minutes; the refresh token lives 30 days. Before
 * this, the refresh token was saved on login and then never read by anything —
 * so fifteen minutes after signing in, the next request 401'd, the auth
 * context saw a 401 and logged the user out. That is the "it keeps signing me
 * out" and "a reload sends me back to login" behaviour, and it had nothing to
 * do with the session being genuinely invalid.
 *
 * `inFlight` collapses concurrent renewals: a dashboard firing six requests at
 * once must not send six refreshes and rotate the token from under itself.
 */
let inFlight = null;

async function renewAccessToken() {
  const refreshToken = auth.refresh;
  if (!refreshToken) return false;

  inFlight ??= (async () => {
    try {
      const res = await fetch(BASE + '/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false || !json.data?.accessToken) return false;
      auth.save(json.data);          // accessToken + rotated refreshToken + user
      return true;
    } catch {
      // A network failure is not an invalid session; leave the tokens alone.
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

async function req(path, { method = 'GET', body, noAuth = false, raw = false, _retried = false } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (!noAuth && auth.token) headers.Authorization = `Bearer ${auth.token}`;

  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new ApiError('Network error — is the backend running on ' + (BASE || 'the proxy') + '?', 0);
  }

  /**
   * One silent renewal per request, then replay.
   *
   * Only for an expired access token on an authenticated call: `noAuth` routes
   * have no session to renew, and `_retried` stops a refresh endpoint that
   * itself 401s from looping. A 403 is a real authorisation decision and is
   * never retried.
   */
  if (res.status === 401 && !noAuth && !_retried && auth.refresh) {
    if (await renewAccessToken()) {
      return req(path, { method, body, noAuth, raw, _retried: true });
    }
  }

  if (raw) return res;

  /**
   * A 2xx that is not one of our envelopes is a failure.
   *
   * `res.json()` failing used to fall through to `{}`, and `{}.ok` is not
   * `false`, so the request RESOLVED — with `data: undefined`. Every caller
   * then wrote `undefined` into the state it was loading, and every screen that
   * reads "no data yet" as "still loading" sat on its skeleton forever: no
   * error, no retry, no way out. The policy pages and the sign-in method list
   * both do exactly that.
   *
   * This is not a hypothetical. It is what a misconfigured SPA rewrite does:
   * Netlify or a CDN answering `/api/*` with the app's own `index.html` returns
   * HTTP 200 and a body of HTML. The API is completely unreachable and the app
   * shows a loading state that never ends — the single hardest failure to
   * diagnose from a bug report, because "it just spins" describes both a slow
   * network and a total outage.
   *
   * Every endpoint here answers `{ ok, data }` or `{ ok: false, error }`, so a
   * body with neither did not come from this API, whatever its status code.
   */
  const parsed = await res.json().then(
    (j) => ({ ok: true, json: j }),
    () => ({ ok: false, json: null }),
  );

  if (!parsed.ok) {
    throw new ApiError(
      res.ok
        ? 'The server returned a response this app could not read. If this persists, the API may not be reachable at ' + (BASE || 'the configured address') + '.'
        : `Request failed (${res.status})`,
      res.status,
    );
  }

  const json = parsed.json ?? {};
  if (!res.ok || json.ok === false) {
    const msg = json?.error?.message || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, json?.error);
  }

  // A 2xx envelope with no `ok` marker is not one of ours either.
  if (typeof json.ok === 'undefined' && typeof json.data === 'undefined') {
    throw new ApiError(
      'The server returned an unexpected response. The API may not be reachable at '
      + (BASE || 'the configured address') + '.',
      res.status,
    );
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

  /**
   * Sign out on the server, revoking every refresh token for this account.
   *
   * Deliberately not retried and never allowed to reject: the caller clears
   * local state immediately afterwards, and a user who has asked to sign out
   * must end up signed out on this device even if the network is down. The
   * server-side revocation is the part that can fail; the local clear is not.
   */
  logout: () => req('/api/auth/logout', { method: 'POST' }).catch(() => null),
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

  /* ── Several Pages ───────────────────────────────────────────────────────
   * A creator may administer more than one Page and connect all of them. The
   * endpoints above still answer for the primary Page when no id is given, so
   * these are additions rather than replacements.
   */

  /** Add several Pages in one request, rather than one call per tick-box. */
  selectFacebookPages: (pageIds) =>
    req('/api/facebook/pages/select', { method: 'POST', body: { pageIds } }),

  /** The Pages this user has connected — read from us, not from Facebook. */
  connectedFacebookPages: () => req('/api/facebook/pages/connected'),

  /** Nominate the Page shown on the public profile and used by discovery. */
  setPrimaryFacebookPage: (pageId) =>
    req('/api/facebook/pages/primary', { method: 'POST', body: { pageId } }),

  /** Remove one Page, leaving the rest connected. */
  disconnectFacebookPage: (pageId) =>
    req(`/api/facebook/pages/${encodeURIComponent(pageId)}`, { method: 'DELETE' }),

  /** Sync one Page; without an id every connected Page is refreshed. */
  syncFacebookPage: (pageId) =>
    req('/api/facebook/sync', { method: 'POST', body: pageId ? { pageId } : undefined }),

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

  /**
   * The landing page's four numbers — creators, campaigns run, paid out through
   * escrow, and the live commission rate. `noAuth` because the caller is an
   * anonymous visitor; the response is four platform-wide aggregates.
   */
  platformStats: () => req('/api/platform/stats', { noAuth: true }),

  myProfile: () => req('/api/users/me/profile'),
  /**
   * Everything the onboarding screens need in one call: what signup already
   * captured, what is still missing, and which platforms are connected. The
   * server owns this so the UI never re-asks for a value it already holds.
   */
  onboardingState: () => req('/api/users/me/onboarding'),
  avatarUploadUrl: (fileName, contentType) =>
    req('/api/users/me/logo-upload-url', { method: 'POST', body: { fileName, contentType, purpose: 'avatar' } }),
  /** Cover/banner image for the creator profile header. */
  bannerUploadUrl: (fileName, contentType) =>
    req('/api/users/me/logo-upload-url', { method: 'POST', body: { fileName, contentType, purpose: 'banner' } }),
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
  /** The negotiation on a collaboration: thread plus every proposal version. */
  getNegotiation: (dealId) => req(`/api/deals/${dealId}/negotiation`),
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

  /**
   * Brand payment methods — reference records of how a brand pays, not saved
   * instruments. Escrow is still funded through `createPaymentSession` above
   * and Cashfree's hosted checkout; nothing here is ever charged.
   */
  brandPaymentMethods: () => req('/api/payments/methods'),
  addBrandPaymentMethod: (payload) => req('/api/payments/methods', { method: 'POST', body: payload }),
  updateBrandPaymentMethod: (id, payload) => req(`/api/payments/methods/${id}`, { method: 'PATCH', body: payload }),
  setDefaultBrandPaymentMethod: (id) => req(`/api/payments/methods/${id}/default`, { method: 'POST' }),
  removeBrandPaymentMethod: (id) => req(`/api/payments/methods/${id}`, { method: 'DELETE' }),

  createReview: (dealId, payload) => req(`/api/reviews/deal/${dealId}`, { method: 'POST', body: payload }),
  reviewsForUser: (userId) => req(`/api/reviews/user/${userId}`),
  notifications: (unread = false) => req(`/api/notifications${unread ? '?unread=true' : ''}`),
  markNotificationsRead: (ids) => req('/api/notifications/read', { method: 'POST', body: { ids } }),

  // Campaigns
  createCampaign: (payload) => req('/api/campaigns', { method: 'POST', body: payload }),
  /**
   * A brand's own campaigns (optionally by status), or the open catalogue for a
   * creator. `params` carries the creator-side search and filters — q, category,
   * platform, minBudget, maxBudget — which the same endpoint applies on top of
   * the visibility rule, so filtering never happens only in the browser.
   */
  listCampaigns: (status, params = {}) => {
    const qs = new URLSearchParams({ ...(status ? { status } : {}), ...params });
    const query = qs.toString();
    return req(`/api/campaigns${query ? `?${query}` : ''}`);
  },

  /**
   * Put a draft or rejected campaign back into the review queue.
   *
   * Separate from `updateCampaign` because saving an edit and asking to be
   * reviewed are different acts — a brand reworking a rejection over several
   * sittings should not re-enter the queue on every save.
   */
  submitCampaignForReview: (id) => req(`/api/campaigns/${id}/submit`, { method: 'POST' }),

  /* ── Policy 5.5 option B — paid extra revisions ────────────────────────
   * Once the included rounds are used, more revisions are new scope. The
   * brand proposes a fee, the creator accepts or declines, and the rounds
   * exist only once the money is in escrow. Three calls, three actors,
   * deliberately not collapsible into one.
   */
  proposeAdditionalTerms: (dealId, { amount, revisionsAdded, scopeNote, deadline } = {}) =>
    req(`/api/deals/${dealId}/additional-terms`, {
      method: 'POST',
      body: { amount, revisionsAdded, ...(scopeNote ? { scopeNote } : {}), ...(deadline ? { deadline } : {}) },
    }),
  respondToAdditionalTerms: (dealId, accept, declineReason) =>
    req(`/api/deals/${dealId}/additional-terms/respond`, {
      method: 'POST',
      body: { accept, ...(declineReason ? { declineReason } : {}) },
    }),
  startAdditionalTermsPayment: (dealId) =>
    req(`/api/deals/${dealId}/additional-terms/payment-session`, { method: 'POST' }),
  listCampaignsForBrand: (brandUserId) => req(`/api/campaigns?brand=${brandUserId}`),
  getCampaign: (id) => req(`/api/campaigns/${id}`),
  updateCampaign: (id, payload) => req(`/api/campaigns/${id}`, { method: 'PATCH', body: payload }),
  /**
   * What is still missing before a campaign can be published. The wizard's
   * review step reads this rather than deciding for itself, so the checklist a
   * brand sees is the one the publish gate actually enforces.
   */
  campaignReadiness: (id) => req(`/api/campaigns/${id}/readiness`),
  /** Campaign and product imagery, through the existing upload-url endpoint. */
  campaignUploadUrl: (fileName, contentType) =>
    req('/api/users/me/logo-upload-url', { method: 'POST', body: { fileName, contentType, purpose: 'campaign' } }),
  /**
   * Apply, with the application itself. The body is validated server-side
   * against the campaign's own questions, so an answer to a question that has
   * since changed is refused rather than stored.
   */
  applyToCampaign: (id, application) =>
    req(`/api/campaigns/${id}/apply`, { method: 'POST', body: application }),
  withdrawApplication: (id, reason) =>
    req(`/api/campaigns/${id}/withdraw`, { method: 'POST', body: reason ? { reason } : {} }),
  myApplications: () => req('/api/campaigns/applied'),
  applicationUploadUrl: (fileName, contentType) =>
    req('/api/users/me/logo-upload-url', { method: 'POST', body: { fileName, contentType, purpose: 'application' } }),
  /**
   * Applicants for the brand's own campaign. `status` narrows to one review
   * state and `sort` orders the queue; the response's `meta.counts` carries
   * every status's count so the tabs stay honest while a filter is on.
   */
  listCampaignApplicants: (id, params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    const query = qs.toString();
    return req(`/api/campaigns/${id}/applicants${query ? `?${query}` : ''}`);
  },
  // §10 — campaigns this creator has applied to, with status from the server.
  listMyApplications: () => req('/api/campaigns/applied'),
  decideApplicant: (id, creatorId, status, message) =>
    req(`/api/campaigns/${id}/applicants/${creatorId}`, {
      method: 'PATCH', body: { status, ...(message ? { message } : {}) },
    }),

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

  /* ── Campaign approval ─────────────────────────────────────────────────
   * Approval is the only route to a published campaign — the brand-facing
   * PATCH cannot set `open`. Rejection requires a reason, which is shown to
   * the brand verbatim; `internalNote` is for the next reviewer and is never
   * sent to the brand.
   */
  adminCampaignQueue: (status = 'pending_review') =>
    req(`/api/admin/campaigns?status=${encodeURIComponent(status)}`),
  adminDecideCampaign: (id, decision, { reason, internalNote } = {}) =>
    req(`/api/admin/campaigns/${id}/decide`, {
      method: 'POST',
      body: { decision, ...(reason ? { reason } : {}), ...(internalNote ? { internalNote } : {}) },
    }),
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