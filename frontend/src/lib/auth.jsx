import { createContext, useContext, useState, useCallback } from 'react';
import { auth as store, api } from './api';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(store.user);

  const login = useCallback((payload) => {
    store.save(payload);
    setUser(payload.user || store.user);
  }, []);

  const logout = useCallback(() => {
    store.clear();
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, isAuthed: !!user, login, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
