# Gallery setup guide

Step-by-step integration for **Playwright 1.62+ gallery component testing** with `playwright-stubs`.

## Prerequisites

- Vite-based app (React, Vue, Svelte, …)
- `@playwright/test` 1.62+
- `playwright-stubs` installed

## 1. Vite plugin

Add to the **same** Vite config that serves your dev server / gallery:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { playwrightStubs } from 'playwright-stubs/vite-plugin'

export default defineConfig({
  plugins: [react(), playwrightStubs()],
})
```

Plugin options:

| Option | Default | Description |
|---|---|---|
| `debug` | `false` | Log proxied modules |
| `exclude` | React, tooling, gallery | Extra exclude patterns |
| `includeNodeModules` | `true` | Proxy npm packages |

The gallery entry (`playwright/gallery/`) is excluded from proxying automatically — it must define `window.mount`.

## 2. Stories

Create `*.story.tsx` files next to your components:

```tsx
// src/demo/UserProfile.story.tsx
import { UserProfile } from './UserProfile'

export function Default({ id = '1' }: { id?: string }) {
  return <UserProfile id={id} />
}
```

Story id: `demo/UserProfile/Default` (path under `src/` + export name).

## 3. Gallery page

```text
playwright/
  gallery/
    index.html
    main.tsx
```

See this repository's `playwright/gallery/` for a working React example. The gallery must expose `window.mount({ story, props })` and `window.unmount()`.

## 4. Playwright config

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

const galleryUrl = 'http://127.0.0.1:5173/playwright/gallery/index.html'

export default defineConfig({
  projects: [
    {
      name: 'components',
      testDir: './tests/components',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: galleryUrl,
        serviceWorkers: 'block',
      },
    },
  ],
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5173',
    url: galleryUrl,
    reuseExistingServer: !process.env.CI,
  },
})
```

For CI (or when mocking npm packages), prefer `vite build && vite preview` so every import goes through the stubs proxy — see this repo's `playwright.config.ts`.

## 5. Fixtures

```ts
// tests/components/fixtures.ts
import { test as base } from '@playwright/test'
import { withMocks } from 'playwright-stubs/fixture'

export const test = withMocks(base)
export { expect } from 'playwright-stubs/assertions'
```

## 6. Example test

```ts
// tests/components/user.spec.tsx
import { test, expect } from './fixtures'

const getUser = test.mock('./api', 'getUser')
getUser.mockResolvedValue({ id: '123', name: 'Alice' })

test('renders user', async ({ mount }) => {
  const component = await mount('demo/UserProfile/Default', { id: '123' })
  await expect(component.getByText('Alice')).toBeVisible()
  await expect(getUser).toHaveBeenCalledWith('123')
})
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `window.mount()` not defined | Ensure `playwright/gallery/` is excluded from proxying; check gallery `main.tsx` loads |
| Mock never attached | Wrong specifier — use the same string the component imports, or a suffix path like `src/demo/api` |
| `mockImplementation` captures `undefined` | Node closures don't cross the boundary — use `mockReturnValue` / `mockResolvedValue` |
| Ambiguous specifier | Use a longer path (`./dup/dependency` vs `dependency`) |

## Post-mount reconfiguration

```ts
const foo = test.mock('./dependency', 'foo')

test('updates mock after mount', async ({ mount }) => {
  const component = await mount('demo/Recalc/Default')
  foo.mockReturnValue(999)
  await foo.sync()
  await component.getByRole('button', { name: 'recalc' }).click()
})
```
