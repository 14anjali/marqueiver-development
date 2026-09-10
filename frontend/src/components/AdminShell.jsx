import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Logo } from './ui';
import { Menu, X, ChevDown } from './icons';
import { useAuth } from '../lib/auth';

// Admin nav — same visual language as AppShell (brand colors, card styles,
// Logo component) but its own nav items, since an admin is a different role
// from creator/brand and shouldn't see their nav.
const ADMIN_NAV = [
  ['Dashboard', '/admin'],
  ['Verifications', '/admin/verifications'],
  ['Deals', '/admin/deals'],
  ['Users', '/admin/users'],
  ['Reviews', '/admin/reviews'],
  ['Wallets', '/admin/wallets'],
  ['Team', '/admin/team'],
  ['Audit Log', '/admin/audit'],
];

export default function AdminShell({ children }) {
  const loc = useLocation();
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menu, setMenu] = useState(false);

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-30 bg-white border-b border-line">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-16 flex items-center gap-8">
          <button className="lg:hidden -ml-1 p-2 text-muted" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu className="w-5 h-5" /></button>
          <Link to="/admin" className="flex items-center gap-2">
            <Logo />
            <span className="pill bg-ink text-white text-[10px]">ADMIN</span>
          </Link>
          <nav className="hidden lg:flex items-center gap-5 ml-2">
            {ADMIN_NAV.map(([label, path]) => {
              const active = loc.pathname === path;
              return (
                <Link key={label} to={path} className={`relative text-sm font-medium transition whitespace-nowrap ${active ? 'text-brand-600' : 'text-muted hover:text-ink'}`}>
                  {label}
                  {active && <span className="absolute -bottom-[21px] left-0 right-0 h-0.5 bg-brand-600 rounded-full" />}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-full bg-ink text-white flex items-center justify-center font-bold text-sm">A</span>
                <span className="hidden sm:block leading-tight text-left">
                  <span className="block text-sm font-semibold text-ink capitalize">{user?.adminLevel || 'Admin'}</span>
                  <span className="block text-[11px] text-muted">{user?.phone || user?.email || ''}</span>
                </span>
                <ChevDown className="w-4 h-4 text-muted hidden sm:block" />
              </button>
              {menu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
                  <div className="absolute right-0 mt-2 w-44 bg-white border border-line rounded-xl shadow-pop py-1 z-50">
                    <button onClick={() => { logout(); nav('/login'); }} className="block w-full text-left px-4 py-2 text-sm text-rose-500 hover:bg-bg">Sign out</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {mobileOpen && (
          <div className="lg:hidden fixed inset-0 z-50">
            <div className="fixed inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
            <div className="fixed inset-y-0 left-0 w-72 bg-white shadow-pop flex flex-col">
              <div className="h-16 flex items-center justify-between px-4 border-b border-line">
                <Logo />
                <button className="p-2 text-muted" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X className="w-5 h-5" /></button>
              </div>
              <nav className="flex flex-col p-2">
                {ADMIN_NAV.map(([label, path]) => (
                  <Link key={label} to={path} onClick={() => setMobileOpen(false)}
                    className={`px-3 py-2.5 rounded-lg text-sm font-medium ${loc.pathname === path ? 'bg-brand-50 text-brand-600' : 'text-ink hover:bg-bg'}`}>
                    {label}
                  </Link>
                ))}
                <div className="border-t border-line my-2" />
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
