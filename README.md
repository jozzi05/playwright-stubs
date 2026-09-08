# playwright-stubs

Jest/Vitest-style **module export mocking** for Playwright component tests in a real browser.

Standalone npm library — **Vite only**. Not part of Playwright core.

Playwright owns the browser/test lifecycle, Vite owns the module graph, and
`playwright-stubs` adds dependency interception between them.

```tsx
import { test, expect } from './fixtures'

const getUser = test.mock('./api', 'getUser')
getUser.mockResolvedValue({ id: '123', name: 'Alice' })

test('renders user', async ({ mount }) => {
  const component = await mount('demo/UserProfile/Default', { id: '123' })
  await expect(component.getByText('Alice')).toBeVisible()
  await expect(getUser).toHaveBeenCalledWith('123')
})
```

This mocks the **dependency boundary** (`import { getUser } from './api'`), not the network boundary (`page.route`).

## Requirements

- **Node 18+**
- **Vite 5, 6, or 7** (required — the plugin hooks `resolveId`/`load`; webpack/Next are not supported)
- **@playwright/test 1.62+** with [gallery component testing](https://playwright.dev/docs/test-components)
- This is a **third-party** library, not `@playwright/test` built-in

## What is supported

| Import form | Mockable |
|---|---|
| `import { foo } from './m'` | yes |
| `import foo from './m'` (default function) | yes — `test.mock('./m', 'default')` |
| default-exported plain object | yes, per method — `test.mock('./m', 'default.get')` |
| `import * as ns from './m'` | yes |
| `export { foo } from './m'` (facade) | yes |
| `export * from './m'` | yes |
| `await import('./m')` (dynamic) | yes |
| Vite `resolve.alias` imports | yes — mock via canonical path (e.g. `src/demo/api`) |
| `export let` / `export class` | not mockable (by design) |
| Internal lexical calls (`a()` calling sibling `b()`) | not mockable (ESM limit) |

See [docs/GALLERY-SETUP.md](./docs/GALLERY-SETUP.md) for full setup.

## How it works

```text
consumer:  import { getUser } from './api'
                     |
                     |  resolveId redirect (Vite plugin)
                     v
           generated proxy module
             ├─ import * as real from the real module (untransformed)
             ├─ registers with the browser registry
             └─ re-exports each export behind a stable wrapper
                     |
                     v
           active mock | once-queue | spy | original
```

- **Consumers are never transformed** — only dependency modules get a tiny generated proxy.
- **Node↔browser bridge is data-only** — no Node callback per invocation.
- **Declare mocks with `test.mock()`** at the top of the test file (vi.mock/jest.mock style).

## Setup

### 1. Install

```bash
npm install -D playwright-stubs
```

### 2. Vite plugin

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { playwrightStubs } from 'playwright-stubs/vite-plugin'

export default defineConfig({
  plugins: [react(), playwrightStubs()],
})
```

### 3. Gallery page

See [docs/GALLERY-SETUP.md](./docs/GALLERY-SETUP.md) for the `playwright/gallery/` boilerplate.

### 4. Playwright config

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

### 5. Fixtures

```ts
// tests/components/fixtures.ts
import { test as base } from '@playwright/test'
import { withMocks } from 'playwright-stubs/fixture'

export const test = withMocks(base)
export { expect } from 'playwright-stubs/assertions'
```

## API

Declare mocks at the **top of the test file** with `test.mock()`:

```ts
const getUser = test.mock('./api', 'getUser')
getUser.mockResolvedValue({ id: '1', name: 'Alice' })

test('renders', async ({ mount }) => {
  const component = await mount('demo/UserProfile/Default', { id: '1' })
  await expect(getUser).toHaveBeenCalledWith('1')
})
```

| Method | Behavior |
|---|---|
| `mockReturnValue` / `mockResolvedValue` / `mockRejectedValue` | serialized value, applied browser-side |
| `mockImplementation(fn)` | closure-free function source, evaluated in the browser |
| `mock*Once(...)` | once-queue before default |
| `mockClear()` / `mockReset()` / `mockRestore()` | lifecycle |
| `await handle.sync()` | flush after `mount()` when reconfiguring mocks |
| `await expect(handle).toHaveBeenCalledWith(...)` | async matchers |

`test.mock.module(specifier, { name: fn })` mocks several exports at once (function implementations only).

The fixture intentionally replaces Playwright's built-in `mount`: it flushes
mock commands after gallery navigation but before the lazy story import
evaluates. See [the gallery setup guide](./docs/GALLERY-SETUP.md#lifecycle-and-compatibility)
for the lifecycle, repeated-mount behavior, and the `test.mock()` stack-trace
compatibility constraint.

### When to use what

| Approach | Use for |
|---|---|
| **Stories** | Default component scenarios, gallery browsing |
| **playwright-stubs** | Pin dependency return values, spy on integration calls |
| **`page.route()`** | HTTP/network interception |

## AI-assisted component testing

Great fit for LLM workflows: pin dependency state with `test.mock().mockResolvedValue(...)`, mount a story, assert DOM + screenshots. See [docs/LLM-COMPONENT-TESTING.md](./docs/LLM-COMPONENT-TESTING.md).

## Repository layout

```text
src/core/            browser runtime: registry, dispatch
src/vite-plugin/     resolveId proxying, export analysis
src/playwright/      fixture, matchers
playwright/gallery/  gallery entry (your app owns this)
tests/ct/            browser integration tests
```

## Running (this repo)

```bash
npm install
node node_modules/@playwright/test/cli.js install chromium
npm test
```
