import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Pin the dev port so it always matches the EVE SSO callback URL
    // (http://localhost:5177/auth/callback). Fail instead of silently
    // switching to another port if 5177 is taken.
    port: 5177,
    strictPort: true,
    // Proxy API calls to the Express backend (port 4000) in dev.
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
