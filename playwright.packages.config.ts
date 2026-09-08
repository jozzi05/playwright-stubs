import { defineConfig, devices } from '@playwright/test'

const galleryUrl = 'http://127.0.0.1:5173/playwright/gallery/index.html'

/**
 * npm dependency interception is separately exercised against Vite's
 * production module graph. Vite dev prebundles CJS packages before resolveId.
 */
export default defineConfig({
  testDir: './tests/ct',
  testMatch: '**/packages.spec.tsx',
  fullyParallel: true,
  reporter: 'list',
  use: { trace: 'on-first-retry' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: galleryUrl,
        serviceWorkers: 'block',
        reuseContext: true,
      },
    },
  ],
  webServer: {
    command: 'vite build && vite preview --host 127.0.0.1 --port 5173',
    url: galleryUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
