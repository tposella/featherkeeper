import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  // The GitHub Pages demo lives under /featherkeeper/; a real install is served from /.
  base: process.env.VITE_BASE ?? '/',
  server: {
    port: 5173,
    // In development, forward API calls to the Node server (npm run dev in apps/api).
    proxy: {
      '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
