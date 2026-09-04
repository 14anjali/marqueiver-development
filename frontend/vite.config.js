import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // proxy API calls to the backend so the frontend can talk to it in dev
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/health': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * Split the vendor code by who actually needs it.
         *
         * Everything used to land in one ~1MB chunk, which meant a visitor on
         * the landing page downloaded and parsed the dashboard's charting
         * library before they could see the hero. These three split cleanly
         * along real usage boundaries:
         *
         *  - `vendor-charts` (recharts) is only reachable from the signed-in
         *    analytics screens. The public site never loads it.
         *  - `vendor-motion` (framer-motion) is the public site's animation
         *    layer, cached separately so an app-side deploy does not invalidate
         *    it.
         *  - `vendor-react` changes least often of all, so it stays cached
         *    across almost every release.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts';
          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) {
            return 'vendor-motion';
          }
          if (id.includes('react-router') || id.includes('/react-dom/') || id.includes('/react/')) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
});
