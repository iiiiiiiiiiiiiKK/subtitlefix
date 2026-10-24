import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config. The suite runs against the real production build (`vite preview`)
 * so what we test is what ships to GitHub Pages.
 *
 * The preview port is deliberately unusual: `reuseExistingServer` stays false so a
 * leftover dev server from another checkout can never be tested by accident.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4899',
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // iPhone emulation on Chromium so CI only needs one browser download.
    {
      name: 'iphone-13',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        defaultBrowserType: undefined,
      },
    },
  ],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --port 4899 --strictPort',
    url: 'http://127.0.0.1:4899',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

