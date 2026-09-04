/** @type {import('tailwindcss').Config} */

/**
 * Marqueiver design tokens.
 *
 * The palette is built around one rule: **ochre is money.** It marks amounts
 * and escrow state and is used for nothing else, so a rupee figure is legible
 * at a glance anywhere in the product. Jade confirms, rose warns, violet is
 * the brand and carries interaction. Nothing is a decorative accent.
 *
 * `ink` is a warm aubergine rather than a tinted near-black — it belongs to
 * the violet family, so dark sections read as Marqueiver rather than as a
 * generic dark mode.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F5F3FF', 100: '#EDE9FE', 200: '#DDD6FE', 300: '#C4B5FD',
          400: '#A78BFA', 500: '#8B5CF6', 600: '#7C3AED', 700: '#6D28D9',
          800: '#5B21B6', 900: '#4C1D95',
        },
        // Money and escrow. Reserved — never decorative.
        money: {
          50: '#FDF6E9', 100: '#FAE9C8', 300: '#F0C67B',
          500: '#E8A33D', 600: '#C9821D', 700: '#9A6314',
        },
        // Confirmation and completed states.
        jade: { 50: '#E7F6F1', 100: '#C6EBE0', 500: '#0F8A6A', 600: '#0B6E55', 700: '#08543F' },
        pink: { 500: '#EC4899', 600: '#DB2777' },

        ink: '#1B1130',        // warm aubergine, the dark ground
        'ink-soft': '#3A2D57', // secondary text on light
        muted: '#6B6480',
        line: '#E8E4F0',       // lilac-tinted hairline, not neutral grey
        bg: '#FAF9FD',
        lilac: '#F3EFFF',      // field / wash
        avail: { bg: '#E7F6F1', fg: '#0B6E55' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
      },
      fontSize: {
        // Display scale, tightened as it grows — headline type is a design
        // element here, not a delivery vehicle.
        'display-sm': ['1.75rem', { lineHeight: '1.15', letterSpacing: '-0.018em' }],
        'display-md': ['2.5rem', { lineHeight: '1.08', letterSpacing: '-0.024em' }],
        'display-lg': ['3.25rem', { lineHeight: '1.04', letterSpacing: '-0.03em' }],
        'display-xl': ['4rem', { lineHeight: '1.0', letterSpacing: '-0.034em' }],
      },
      boxShadow: {
        // A real elevation scale: flat surfaces, raised surfaces, and the one
        // lifted thing on a page. Not the same soft grey under everything.
        flat: '0 1px 2px rgba(27,17,48,0.04)',
        card: '0 1px 3px rgba(27,17,48,0.06), 0 1px 2px rgba(27,17,48,0.04)',
        raised: '0 6px 18px -6px rgba(27,17,48,0.14)',
        lifted: '0 22px 48px -18px rgba(27,17,48,0.34)',
        cardhover: '0 8px 24px rgba(27,17,48,0.10)',
        pop: '0 12px 32px rgba(27,17,48,0.14)',
      },
      borderRadius: { xl2: '1rem', xl3: '1.5rem' },
      maxWidth: { prose: '52ch' },
      backgroundImage: {
        'brand-grad': 'linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)',
        'cta-grad': 'linear-gradient(90deg, #EC4899 0%, #F43F5E 100%)',
        'logo-grad': 'linear-gradient(135deg, #A855F7 0%, #EC4899 55%, #F59E0B 100%)',
      },
      keyframes: {
        // The single orchestrated moment: the offer stack settling on load.
        settle: {
          '0%': { transform: 'translateY(14px) scale(0.985)', opacity: '0' },
          '100%': { transform: 'translateY(0) scale(1)', opacity: '1' },
        },
      },
      animation: { settle: 'settle .55s cubic-bezier(.2,.7,.3,1) both' },
    },
  },
  plugins: [],
};
