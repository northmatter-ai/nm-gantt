import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The public demo is served from a sub-path (GitHub Pages: /nm-gantt/); the Pages workflow sets DEMO_BASE.
  // Locally and in e2e it stays at the root.
  base: process.env.DEMO_BASE ?? '/',
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
