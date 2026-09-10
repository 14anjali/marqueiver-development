// Image that fades in, and on error shows a branded gradient instead of a broken box.
export default function Img({ src, alt = '', className = '', fallbackClass = '' }) {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={`${className} bg-gradient-to-br from-brand-100 to-pink-100 ${fallbackClass}`}
      onError={(e) => { e.currentTarget.style.opacity = '0'; }}
    />
  );
}
