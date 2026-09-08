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
    command: 'npx vite --host 127.0.0.1 --port 5173',
    url: galleryUrl,
    reuseExistingServer: !process.env.CI,
  },
})
