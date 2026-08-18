/** @type {import('tailwindcss').Config} */
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
        pink: {
          500: '#EC4899', 600: '#DB2777',
        },
        ink: '#1A1A2E',
        muted: '#6B7280',
        line: '#EAECF0',
        bg: '#F9FAFB',
        avail: { bg: '#DCFCE7', fg: '#15803D' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(16,24,40,0.06), 0 1px 2px rgba(16,24,40,0.04)',
        cardhover: '0 8px 24px rgba(16,24,40,0.10)',
        pop: '0 12px 32px rgba(16,24,40,0.14)',
      },
      borderRadius: { xl2: '1rem' },
      backgroundImage: {
        'brand-grad': 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
        'cta-grad': 'linear-gradient(90deg, #EC4899 0%, #F43F5E 100%)',
        'logo-grad': 'linear-gradient(135deg, #A855F7 0%, #EC4899 55%, #F59E0B 100%)',
      },
    },
  },
  plugins: [],
};
