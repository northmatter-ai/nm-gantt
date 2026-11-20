import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3612', viewport: { width: 1600, height: 900 } },
  webServer: {
    command: 'npx vite build && npx vite preview --port 3612 --strictPort',
    url: 'http://localhost:3612',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
