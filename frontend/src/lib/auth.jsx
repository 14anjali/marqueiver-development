import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { auth as store, api } from './api';

/**
 * Session state.
 *
 * The rule: **the server decides who you are and where you belong.** What is
 * kept in localStorage is the access token and a cached copy of the last known
 * user, and the cache exists only so the first paint after a reload is not a
 * spinner. On mount the provider calls `/auth/me` and replaces it.
 *
 * This is a change of authority, not just of plumbing. Previously the role was
 * whatever the login form put in localStorage under `mq_user`, and every route
 * guard read it — so editing one localStorage key changed which side of the
 * product you saw. Now `role` and `next` both come from the server, `next` is
 * recomputed on every `/auth/me`, and the guards route on that.
 *
 * The backend enforces authorisation regardless; none of this is a security
 * boundary. It is what stops the UI from *disagreeing* with the backend and
 * stranding a user on a page the API will refuse to serve.
 */

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  // Cached for first paint only; `/auth/me` is the authority and lands moments later.
  const [user, setUser] = useState(store.user);
  const [next, setNext] = useState(null);
  const [outstandingPolicies, setOutstandingPolicies] = useState([]);
  const [ready, setReady] = useState(!store.token);

  const applySession = useCallback((payload) => {
    if (payload?.accessToken || payload?.refreshToken) store.save(payload);
    if (payload?.user) {
      store.save({ user: payload.user });
      setUser(payload.user);
    }
    if (payload?.next !== undefined) setNext(payload.next);
    if (payload?.outstandingPolicies !== undefined) setOutstandingPolicies(payload.outstandingPolicies);
  }, []);

  const logout = useCallback(() => {
    store.clear();
    setUser(null);
    setNext(null);
    setOutstandingPolicies([]);
  }, []);

  /** Re-ask the server. Called on mount and whenever a step is completed. */
  const refresh = useCallback(async () => {
    if (!store.token) { setReady(true); return null; }
    try {
      const { data } = await api.me();
      applySession(data);
      return data;
    } catch (err) {
      // 401/403 means this token is no longer a session — a deleted, suspended
      // or expired account. Clearing is correct; anything else is transient
      // (offline, backend restarting) and must not sign the user out.
      if (err?.status === 401 || err?.status === 403) logout();
      return null;
    } finally {
      setReady(true);
    }
  }, [applySession, logout]);

  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo(() => ({
    user,
    next,
    outstandingPolicies,
    ready,
    isAuthed: Boolean(store.token && user),
    role: user?.role ?? null,
    login: applySession,
    logout,
    refresh,
  }), [user, next, outstandingPolicies, ready, applySession, logout, refresh]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
