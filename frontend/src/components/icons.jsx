// Minimal inline-SVG icon set so we don't pull an icon library.
// Each returns an <svg>; size via className (w-4 h-4 etc).

const S = ({ children, className = 'w-5 h-5', stroke = 1.8, viewBox = '0 0 24 24' }) => (
  <svg className={className} viewBox={viewBox} fill="none" stroke="currentColor"
    strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

export const Search = (p) => <S {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></S>;
export const Bell = (p) => <S {...p}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></S>;
export const Heart = (p) => <S {...p}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" /></S>;
export const Bookmark = (p) => <S {...p}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></S>;
export const Menu = (p) => <S {...p}><path d="M3 6h18M3 12h18M3 18h18" /></S>;
export const Filter = (p) => <S {...p}><path d="M22 3H2l8 9.5V19l4 2v-8.5z" /></S>;
export const Sliders = (p) => <S {...p}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></S>;
export const Share = (p) => <S {...p}><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="M16 6l-4-4-4 4" /><path d="M12 2v13" /></S>;
export const Dots = (p) => <S {...p}><circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" /></S>;
export const ChevLeft = (p) => <S {...p}><path d="m15 18-6-6 6-6" /></S>;
export const ChevRight = (p) => <S {...p}><path d="m9 18 6-6-6-6" /></S>;
export const ChevDown = (p) => <S {...p}><path d="m6 9 6 6 6-6" /></S>;
export const MapPin = (p) => <S {...p}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></S>;
export const Star = ({ className = 'w-4 h-4', fill = '#F5A623' }) => (
  <svg className={className} viewBox="0 0 24 24" fill={fill}><path d="M12 2l3 6.3 6.9 1-5 4.8 1.2 6.9L12 17.8 5.9 21l1.2-6.9-5-4.8 6.9-1z" /></svg>
);
export const Check = (p) => <S {...p}><path d="M20 6 9 17l-5-5" /></S>;
export const Clock = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>;
export const Mail = (p) => <S {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></S>;
export const Home = (p) => <S {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></S>;
export const Grid = (p) => <S {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></S>;
export const List = (p) => <S {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></S>;
export const Download = (p) => <S {...p}><path d="M12 3v12" /><path d="m7 12 5 5 5-5" /><path d="M5 21h14" /></S>;
export const Play = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
);
export const Users = (p) => <S {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.9" /><path d="M16 3.1a4 4 0 0 1 0 7.8" /></S>;
export const Send = (p) => <S {...p}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></S>;
export const Handshake = (p) => <S {...p}><path d="m11 17 2 2a1 1 0 1 0 3-3" /><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.9-3.9a2 2 0 0 0-2.8 0l-1.4 1.4a2 2 0 0 1-2.8 0l-.8-.8a2 2 0 0 1 0-2.8l3-3" /><path d="M18 12l1-1" /><path d="M2 12l4-4 4 4" /></S>;

// Verified check badge (blue-violet circle w/ check) used next to names
export const Verified = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none">
    <path d="M12 2l2.4 1.7 2.9-.2 1 2.8 2.4 1.6-.7 2.8.7 2.8-2.4 1.6-1 2.8-2.9-.2L12 22l-2.4-1.7-2.9.2-1-2.8L3.3 16l.7-2.8L3.3 10l2.4-1.6 1-2.8 2.9.2z" fill="#7C3AED" />
    <path d="M8.5 12.2l2.3 2.3 4.7-4.7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Brand-colored platform glyphs (simplified marks)
export const Platform = ({ name, className = 'w-4 h-4' }) => {
  const map = {
    instagram: <svg viewBox="0 0 24 24" className={className}><rect x="2" y="2" width="20" height="20" rx="5.5" fill="url(#ig)" /><defs><linearGradient id="ig" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#FEDA75" /><stop offset=".4" stopColor="#FA7E1E" /><stop offset=".7" stopColor="#D62976" /><stop offset="1" stopColor="#962FBF" /></linearGradient></defs><circle cx="12" cy="12" r="4.2" fill="none" stroke="#fff" strokeWidth="1.7" /><circle cx="17.2" cy="6.8" r="1.2" fill="#fff" /></svg>,
    youtube: <svg viewBox="0 0 24 24" className={className}><rect x="2" y="5" width="20" height="14" rx="4" fill="#FF0000" /><path d="M10 9l5 3-5 3z" fill="#fff" /></svg>,
    linkedin: <svg viewBox="0 0 24 24" className={className}><rect x="2" y="2" width="20" height="20" rx="3" fill="#0A66C2" /><path d="M6.5 9.5V17M6.5 6.6v.01M10 17v-4a2 2 0 0 1 4 0v4M10 17v-7" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></svg>,
    tiktok: <svg viewBox="0 0 24 24" className={className}><rect x="2" y="2" width="20" height="20" rx="5" fill="#000" /><path d="M13 6v6.5a2.5 2.5 0 1 1-2-2.45" fill="none" stroke="#25F4EE" strokeWidth="1.6" strokeLinecap="round" /><path d="M13 6c.4 1.6 1.6 2.7 3.2 2.9" fill="none" stroke="#FE2C55" strokeWidth="1.6" strokeLinecap="round" /></svg>,
    x: <svg viewBox="0 0 24 24" className={className}><rect x="2" y="2" width="20" height="20" rx="5" fill="#000" /><path d="M7 7l10 10M17 7L7 17" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" /></svg>,
    facebook: <svg viewBox="0 0 24 24" className={className}><rect x="2" y="2" width="20" height="20" rx="5" fill="#1877F2" /><path d="M14 8h-1.5c-.8 0-1 .4-1 1v1.5H14l-.4 2.3h-2.1V19" stroke="#fff" strokeWidth="1.7" fill="none" /></svg>,
    pinterest: <svg viewBox="0 0 24 24" className={className}><circle cx="12" cy="12" r="10" fill="#E60023" /><path d="M12 7c-2.2 0-3.7 1.5-3.7 3.4 0 .9.4 1.9 1.2 2.2.1 0 .2 0 .2-.1l.2-.7c0-.1 0-.2-.1-.3-.3-.3-.4-.7-.4-1.2 0-1.4 1-2.5 2.7-2.5 1.5 0 2.3.9 2.3 2.1 0 1.6-.7 2.9-1.7 2.9-.6 0-1-.5-.9-1.1.2-.7.5-1.4.5-1.9 0-.5-.3-.9-.8-.9-.6 0-1.1.7-1.1 1.5 0 .5.2.9.2.9l-.7 3c-.1.6-.1 1.3 0 1.9 0 .1.1.1.2.1 0 0 .8-1 1-1.5l.4-1.4c.2.4.8.7 1.4.7 1.9 0 3.2-1.7 3.2-4 0-1.8-1.5-3.5-3.9-3.5z" fill="#fff" /></svg>,
    threads: <svg viewBox="0 0 24 24" className={className}><rect x="2" y="2" width="20" height="20" rx="5" fill="#000" /><path d="M12 17c-2.5 0-4-1.7-4-5s1.6-5 4-5c1.8 0 3 1 3.3 2.7M12 13.5c1.2 0 2.2-.4 2.2-1.4 0-.8-.7-1.2-1.5-1.2-1 0-1.6.6-1.6 1.4 0 1 .8 1.7 2 1.7 1.4 0 2.4-1 2.4-2.7" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" /></svg>,
  };
  return map[name] || <span className={className} />;
};

// Additive icons for new pages (Portfolio/Analytics/Earnings/Media Kit) and
// the mobile nav — same minimal inline-SVG style as above.
export const X = (p) => <S {...p}><path d="M18 6 6 18M6 6l12 12" /></S>;
export const BarChart = (p) => <S {...p}><path d="M3 3v18h18" /><rect x="7" y="12" width="3" height="6" /><rect x="12" y="8" width="3" height="10" /><rect x="17" y="5" width="3" height="13" /></S>;
export const Wallet = (p) => <S {...p}><rect x="2" y="6" width="20" height="14" rx="2" /><path d="M2 10h20" /><circle cx="17" cy="15" r="1" /></S>;
export const Image = (p) => <S {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></S>;
export const FileText = (p) => <S {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6" /></S>;

// Additive icon for Verification link (Profile page) and star rating input (Reviews).
export const ShieldCheck = (p) => <S {...p}><path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z" /><path d="m9 12 2 2 4-4" /></S>;
