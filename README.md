# playwright-stubs

Prototype of Jest/Cypress-style **module export stubbing for Playwright component tests**, running in a real browser.

```tsx
import { Component } from '../../src/demo/Component'
import { expect, test } from './fixtures'

test('mocked dependency drives the render', async ({ mount, mock }) => {
  const foo = mock('./dependency', 'foo')

  foo.mockReturnValue(999)

  const component = await mount(<Component />)

  await expect(component.getByText('999')).toBeVisible()
  await expect(foo).toHaveBeenCalledWith(10)
})
```

This mocks the **dependency boundary** (`import { foo } from './dependency'`), not the network boundary (`page.route`). The test does not know or care whether the dependency uses fetch, GraphQL, IndexedDB or an SDK.

Status: **milestone 1 prototype** (named function imports from source modules). See [Compatibility contract](#compatibility-contract).

## How it works

```text
Playwright test (Node)
  |  mock('./dependency', 'foo').mockReturnValue(999)
  |  -- queued as plain data, flushed via page.evaluate before mount()
  v
Browser-side stub store (globalThis.__PW_STUBS__, one per page/context)
  ^
  |  registry lookup on every call
  |
stable wrapper around the imported binding
  ^
  |  generated at build time by the Vite plugin
  |
component
```

Three small pieces:

1. **Vite plugin** (`src/vite-plugin/`) — instruments *import sites* in application source. No package allowlist; the import statement itself declares what is mockable:

   ```ts
   // before
   import { foo } from './dependency'

   // after (enforce: 'post', so input is plain ESM after esbuild/React)
   import { __pw_import__ } from 'virtual:playwright-stubs/runtime'
   import { foo as __pw_0_foo } from './dependency'
   const foo = __pw_import__(
     { specifier: './dependency', moduleId: 'src/demo/dependency.ts' },
     'foo',
     __pw_0_foo,
   )
   ```

   Parsing is done with acorn + magic-string (source maps preserved). Anything that resolves into `node_modules` is left untouched in v1.

2. **Browser runtime** (`src/core/`) — `__pw_import__` returns a *stable wrapper* (function identity never changes; cached references stay valid). On every call the wrapper consults the stub store and dispatches to the active mock, the once-queue, or the original implementation. With an entry but no implementation, it records the call and passes through — i.e. a spy.

3. **Playwright fixture** (`src/playwright/`) — the `mock` fixture plus an auto-flushing `mount` override. Mock configuration is serialized data only; no Node callback runs per invocation. `mockImplementation(fn)` ships `fn.toString()` to the browser and evaluates it there (must be closure-free). Call-inspection matchers are async because call data lives in the browser:

   ```ts
   await expect(foo).toHaveBeenCalled()
   await expect(foo).toHaveBeenCalledTimes(1)
   await expect(foo).toHaveBeenCalledWith(10)
   ```

   Teardown wipes the store, so nothing leaks between tests even with context reuse; parallel tests are isolated by Playwright contexts (see `tests/ct/isolation.spec.tsx`).

## Setup

```ts
// playwright-ct.config.ts
import { defineConfig } from '@playwright/experimental-ct-react'
import { playwrightStubs } from './src/vite-plugin'

export default defineConfig({
  use: { ctViteConfig: { plugins: [playwrightStubs()] } },
})
```

```ts
// tests/ct/fixtures.ts
import { test as ctBase } from '@playwright/experimental-ct-react'
import { withMocks } from '../../src/playwright/fixture'

export const test = withMocks(ctBase)
export { expect } from '../../src/playwright/assertions'
```

`playwrightStubs({ debug: true })` logs every transformed module and every skipped binding.

## API

`mock(specifier, exportName)` returns a handle. The specifier is matched against both the raw import specifier and the Vite-resolved module id (extension-insensitive suffix match), so `mock('./dependency', 'foo')` and `mock('src/demo/dependency', 'foo')` both work.

Handle methods (synchronous and chainable; commands are queued and flushed automatically before `mount()` and before any call inspection):

| Method | Behavior |
|---|---|
| `mockReturnValue(v)` / `mockResolvedValue(v)` / `mockRejectedValue(e)` | serialized value/error, interpreted browser-side |
| `mockImplementation(fn)` | `fn` evaluated in the browser; must be closure-free |
| `mock*Once(...)` | once-queue, consumed before the default implementation |
| `mockClear()` | forget recorded calls |
| `mockReset()` | forget calls + implementation + once-queue; keeps spying |
| `mockRestore()` | remove the entry; calls go straight to the original |
| `await handle.sync()` | flush queued commands now (needed when mocking *after* `mount()`) |
| `await handle.calls()` | recorded argument lists |

## Compatibility contract

Guaranteed (tested):

- named imports and aliased named imports of **functions** from **source modules**;
- sync and async mocks, once-queues, spy passthrough;
- mocking before mount and after mount (future calls only);
- automatic cleanup and parallel isolation;
- original behavior preserved when no mock is installed (zero-mock cost: one array lookup per call).

Not supported in v1 (by design, to keep the transformation layer small and boring):

- default imports, namespace imports, re-exports (`export { x } from`), `export *`;
- dynamic `import()`;
- anything resolving into `node_modules` (including CJS interop);
- internal lexical calls: if module `a()` calls sibling `b()` directly, mocking `b` does not affect `a` — mocking targets *consumer-visible bindings*, a fundamental ESM property;
- calls made during module evaluation, if the mock is registered afterwards;
- classes and non-function exports (left untouched, passthrough);
- bindings that the consumer re-exports (skipped, reported by `debug`).

## Repository layout

```text
src/
  core/            browser runtime: stub store, dispatch, module-id matching
  vite-plugin/     import-site transform (acorn + magic-string)
  playwright/      mock fixture, Node<->browser bridge, async matchers
  demo/            example React components used by the CT suite
playwright/        Playwright CT template
tests/
  transform/       golden tests for the transformation (vitest)
  unit/            dispatch state-machine tests (vitest)
  ct/              real-browser integration tests (Playwright CT, chromium)
```

## Running

```bash
npm install
npx playwright install chromium
npm test              # transform/unit tests + browser CT tests
npm run test:transform
npm run test:ct
npm run typecheck
```

Requires Node 18+ (developed on Node 24).
