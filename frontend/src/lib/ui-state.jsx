import { createContext, useContext, useState, useCallback } from 'react';

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-20 right-4 z-[60] space-y-2">
        {toasts.map((t) => (
          <div key={t.id} className={`px-4 py-2.5 rounded-lg shadow-pop text-sm font-medium text-white animate-[slidein_.2s_ease] ${
            t.type === 'error' ? 'bg-rose-500' : t.type === 'success' ? 'bg-emerald-500' : 'bg-ink'}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  return ctx || { push: () => {} };
}

// Simple states for async screens.
export function Spinner({ className = 'w-5 h-5' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function LoadingBlock({ label = 'Loading…' }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted gap-3">
      <Spinner className="w-7 h-7 text-brand-600" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorBlock({ error, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center text-xl">!</div>
      <div className="text-sm text-ink font-medium">{error?.message || 'Something went wrong'}</div>
      {error?.status === 0 && <div className="text-xs text-muted max-w-sm">Start the backend (marqueiver-js) on port 4000, then retry.</div>}
      {onRetry && <button onClick={onRetry} className="btn-outline mt-1">Try again</button>}
    </div>
  );
}

export function EmptyBlock({ title = 'Nothing here yet', sub, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
      <div className="w-12 h-12 rounded-full bg-brand-50 text-brand-400 flex items-center justify-center text-xl">∅</div>
      <div className="text-sm font-medium text-ink">{title}</div>
      {sub && <div className="text-xs text-muted max-w-sm">{sub}</div>}
      {action}
    </div>
  );
}
