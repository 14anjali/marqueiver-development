import { Logo } from './ui';
import { Search, Bell, ChevDown } from './icons';

// Top nav from the Creators discovery screen — brand-side account.
export default function TopNav({ active = 'Creators' }) {
  const links = ['Dashboard', 'Creators', 'Campaigns', 'Messages', 'Notifications', 'Brand Profile'];
  const badge = { Messages: 6, Notifications: 12 };
  return (
    <header className="sticky top-0 z-30 bg-white border-b border-line">
      <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center gap-8">
        <Logo />
        <nav className="hidden lg:flex items-center gap-7 ml-2">
          {links.map((l) => (
            <a key={l} href="#" className={`relative text-sm font-medium transition ${
              active === l ? 'text-brand-600' : 'text-muted hover:text-ink'}`}>
              {l}
              {badge[l] && (
                <span className="absolute -top-2 -right-4 bg-pink-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 inline-flex items-center justify-center">{badge[l]}</span>
              )}
              {active === l && <span className="absolute -bottom-[21px] left-0 right-0 h-0.5 bg-brand-600 rounded-full" />}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <button className="w-9 h-9 rounded-full bg-brand-600 text-white flex items-center justify-center font-bold text-sm">B</button>
          <div className="hidden sm:block leading-tight">
            <div className="text-sm font-semibold text-ink">Brand Name</div>
            <div className="text-[11px] text-muted">Premium Plan</div>
          </div>
          <ChevDown className="w-4 h-4 text-muted" />
        </div>
      </div>
    </header>
  );
}
