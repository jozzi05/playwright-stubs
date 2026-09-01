import { defineConfig, devices } from '@playwright/experimental-ct-react'
import { playwrightStubs } from './src/vite-plugin'

export default defineConfig({
  testDir: './tests/ct',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
    ctViteConfig: {
      plugins: [playwrightStubs()],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
