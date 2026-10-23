import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serverer prosjektsider under /<repo>/. Workflowen setter BASE_PATH ut fra reponavnet.
const base = process.env.BASE_PATH ?? '/middagsplanlegger/';

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Middagsplanlegger',
        short_name: 'Middag',
        description: 'Planlegg ukens middager, handleliste og minst mulig matsvinn.',
        lang: 'nb',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#f8faf7',
        theme_color: '#2f6b3f',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Oppskriftsdata: prøv nett først, men fungerer uten nett i butikken.
            urlPattern: ({ url }) => url.pathname.endsWith('/data/recipes.json'),
            handler: 'NetworkFirst',
            options: { cacheName: 'oppskrifter', networkTimeoutSeconds: 4, expiration: { maxEntries: 2 } },
          },
          {
            urlPattern: ({ request, sameOrigin }) => request.destination === 'image' && !sameOrigin,
            handler: 'CacheFirst',
            options: { cacheName: 'bilder', expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 30 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
});
