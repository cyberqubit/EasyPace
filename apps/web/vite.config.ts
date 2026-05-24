import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// In dev, proxy API + did:web document to the local Worker (wrangler dev :8787).
// In prod, set VITE_API_BASE to the deployed Worker URL at build time.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Self-destroying SW: unregisters any previously-installed service worker
      // and clears its caches, so users always load the freshest deploy. We rely
      // on hashed asset filenames (not a precache) for versioning — no stale UI.
      selfDestroying: true,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'EasyPace — Sage',
        short_name: 'EasyPace',
        description: 'A trustworthy assistant that pays and books for seniors — safely.',
        theme_color: '#1b4332',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/.well-known': 'http://localhost:8787',
    },
  },
});
