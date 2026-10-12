/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'AuthorDesk',
        short_name: 'AuthorDesk',
        description: 'A private writing studio for novelists',
        theme_color: '#2b2a27',
        background_color: '#f7f5f0',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,aff,dic}'],
        maximumFileSizeToCacheInBytes: 5_000_000,
        // The sync API must always reach the network.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  // docs/import-template is bundled as the downloadable import starter template.
  server: { port: 5173, fs: { allow: ['.', '../docs/import-template'] } },
  // Local desktop app: one main chunk is fine; heavy optional parts (docx, spell worker) are split already.
  build: { chunkSizeWarningLimit: 1600 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/setup.ts'],
  },
});
