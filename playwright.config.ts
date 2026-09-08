import { defineConfig, devices } from '@playwright/test'

const galleryUrl = 'http://127.0.0.1:5173/playwright/gallery/index.html'

export default defineConfig({
  testDir: './tests/ct',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: galleryUrl,
        serviceWorkers: 'block',
        reuseContext: false,
      },
    },
  ],
  webServer: {
    // Production build for CI: npm package mocks need every import through the proxy.
    // Local gallery development should still use `vite` (see docs/GALLERY-SETUP.md).
    command: 'vite build && vite preview --host 127.0.0.1 --port 5173',
    url: galleryUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
