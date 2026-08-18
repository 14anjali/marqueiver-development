import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Logo } from './ui';
import { Bell, ChevDown, Menu, X } from './icons';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';

// Role-aware nav — creator and brand see different secondary items.
const COMMON_NAV = [
  ['Dashboard', '/dashboard'],
  ['Discover', '/discover'],
  ['Campaigns', '/campaigns'],
  ['Deals', '/deals'],
  ['Messages', '/messages'],
];
const CREATOR_NAV = [
  ['Portfolio', '/portfolio'],
  ['Analytics', '/analytics'],
  ['Earnings', '/earnings'],
];
const BRAND_NAV = [
  ['Saved', '/saved'],
];

export default function AppShell({ children }) {
  const loc = useLocation();
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const [menu, setMenu] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  const isCreator = user?.role === 'creator';
  const navItems = [...COMMON_NAV, ...(isCreator ? CREATOR_NAV : BRAND_NAV)];
  const initials = isCreator ? 'C' : 'B';

  // Real unread-notification count (feature: no fake notifications). Refetches
  // on route change so it stays current as the user reads notifications.
  useEffect(() => {
    let cancelled = false;
    api.notifications(true).then(({ data }) => { if (!cancelled) setUnread(data?.length ?? 0); }).catch(() => {});
    return () => { cancelled = true; };
  }, [loc.pathname]);

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-30 bg-white border-b border-line">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-16 flex items-center gap-8">
          <button className="lg:hidden -ml-1 p-2 text-muted" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="w-5 h-5" />
          </button>
          <Link to="/discover"><Logo /></Link>
          <nav className="hidden lg:flex items-center gap-6 ml-2">
            {navItems.map(([label, path]) => {
              const active = loc.pathname === path || (path !== '/dashboard' && loc.pathname.startsWith(path));
              return (
                <Link key={label} to={path} className={`relative text-sm font-medium transition ${active ? 'text-brand-600' : 'text-muted hover:text-ink'}`}>
                  {label}
                  {active && <span className="absolute -bottom-[21px] left-0 right-0 h-0.5 bg-brand-600 rounded-full" />}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <Link to="/notifications" className="relative w-9 h-9 rounded-full hover:bg-bg flex items-center justify-center text-muted">
              <Bell className="w-5 h-5" />
              {unread > 0 && (
                <span className="absolute top-1 right-1 bg-pink-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </Link>
            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-full bg-brand-600 text-white flex items-center justify-center font-bold text-sm">{initials}</span>
                <span className="hidden sm:block leading-tight text-left">
                  <span className="block text-sm font-semibold text-ink capitalize">{user?.role || 'Account'}</span>
                  <span className="block text-[11px] text-muted">{user?.phone || user?.email || ''}</span>
                </span>
                <ChevDown className="w-4 h-4 text-muted hidden sm:block" />
              </button>
              {menu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
                  <div className="absolute right-0 mt-2 w-48 bg-white border border-line rounded-xl shadow-pop py-1 z-50">
                    <Link to="/profile" className="block px-4 py-2 text-sm text-ink hover:bg-bg" onClick={() => setMenu(false)}>My Profile</Link>
                    <Link to="/dashboard" className="block px-4 py-2 text-sm text-ink hover:bg-bg" onClick={() => setMenu(false)}>Dashboard</Link>
                    <Link to="/deals" className="block px-4 py-2 text-sm text-ink hover:bg-bg" onClick={() => setMenu(false)}>My Deals</Link>
                    <div className="border-t border-line my-1" />
                    <button onClick={() => { logout(); nav('/login'); }} className="block w-full text-left px-4 py-2 text-sm text-rose-500 hover:bg-bg">Sign out</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Mobile nav drawer — the previous version had no mobile navigation at all. */}
        {mobileOpen && (
          <div className="lg:hidden fixed inset-0 z-50">
            <div className="fixed inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
            <div className="fixed inset-y-0 left-0 w-72 bg-white shadow-pop flex flex-col">
              <div className="h-16 flex items-center justify-between px-4 border-b border-line">
                <Logo />
                <button className="p-2 text-muted" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X className="w-5 h-5" /></button>
              </div>
              <nav className="flex flex-col p-2">
                {navItems.map(([label, path]) => (
                  <Link key={label} to={path} onClick={() => setMobileOpen(false)}
                    className={`px-3 py-2.5 rounded-lg text-sm font-medium ${loc.pathname === path ? 'bg-brand-50 text-brand-600' : 'text-ink hover:bg-bg'}`}>
                    {label}
                  </Link>
                ))}
                <div className="border-t border-line my-2" />
                <Link to="/profile" onClick={() => setMobileOpen(false)} className="px-3 py-2.5 rounded-lg text-sm font-medium text-ink hover:bg-bg">My Profile</Link>
                <Link to="/notifications" onClick={() => setMobileOpen(false)} className="px-3 py-2.5 rounded-lg text-sm font-medium text-ink hover:bg-bg">Notifications</Link>
                <button onClick={() => { logout(); nav('/login'); }} className="px-3 py-2.5 rounded-lg text-sm font-medium text-rose-500 text-left hover:bg-bg">Sign out</button>
              </nav>
            </div>
          </div>
        )}
      </header>
      {children}
    </div>
  );
}
