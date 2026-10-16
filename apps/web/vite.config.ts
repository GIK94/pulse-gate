import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The SPA always talks to the API through relative `/api/...` URLs.
// In development Vite proxies them to the local API; in Docker nginx serves the
// built SPA and the API from the same origin. `changeOrigin` is intentionally NOT
// set: the API validates the Origin header against http://localhost:5173.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
      },
    },
  },
  preview: {
    port: 5173,
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          charts: ['recharts'],
        },
      },
    },
  },
});
