# playwright-stubs

Jest/Vitest-style **module export mocking for Playwright component tests**, running in a real browser.

```tsx
import { UserProfile } from '../../src/demo/UserProfile'
import { expect, test } from './fixtures'

test('renders user', async ({ mount, mock }) => {
  const getUser = mock('@company/api-client', 'getUser')

  getUser.mockResolvedValue({ id: '123', name: 'Alice' })

  const component = await mount(<UserProfile id="123" />)

  await expect(component.getByText('Alice')).toBeVisible()
  await expect(getUser).toHaveBeenCalledWith('123')
})
```

This mocks the **dependency boundary** (`import { getUser } from '@company/api-client'`), not the network boundary (`page.route`). The test does not know or care whether the dependency uses fetch, GraphQL, IndexedDB or an SDK.

## What is supported

| Import form | Mockable |
|---|---|
| `import { foo } from './m'` | yes |
| `import { foo as bar } from './m'` | yes |
| `import foo from './m'` (default function) | yes — `mock('./m', 'default')` |
| default-exported plain object | yes, per method — `mock('./m', 'default.get')`, `this` preserved |
| `import * as ns from './m'` | yes — namespace members are the same shared wrappers |
| `export { foo } from './m'` (facade) | yes — mockable via the facade **and** via the origin module |
| `export * from './m'` | yes — chased at build time, mockable via the facade |
| `await import('./m')` (dynamic) | yes — same interception path as static imports |
| npm packages, ESM (e.g. `clsx`) | yes — `mock('clsx', 'clsx')`, no allowlist |
| npm packages, CJS (e.g. `classnames`) | yes — `mock('classnames', 'default')` |
| circular dependencies, incl. evaluation-time calls | preserved (hoisted wrappers) |
| `export let` mutable bindings | stay **live**, deliberately not mockable |
| `export class` | passes through untouched (constructable, `instanceof`-safe), not mockable |
| module side effects, singleton state, evaluation order | preserved — the real module runs exactly once, unmodified |

Deliberately out of scope: mocking internal lexical calls (module `a()` calling
sibling `b()` directly — a fundamental ESM boundary), mocking non-function
values, replacing whole modules with factories that *remove* exports.

## How it works

```text
consumer:  import { getUser } from './api'
                     |
                     |  resolveId redirect (Vite plugin)
                     v
           \0pw-proxy:/abs/src/api.ts        <- generated proxy module
             ├─ import * as real from '/abs/src/api.ts'   (the real module,
             ├─ export * from '/abs/src/api.ts'            untransformed)
             ├─ registers itself with the browser registry
             └─ re-exports each export behind a stable wrapper
                     |
                     |  per call: registry lookup
                     v
           active mock | once-queue | spy passthrough | original
```

- **Universal interception, one mechanism.** Every import of an in-scope
  module — static, dynamic, re-export, from source or node_modules — resolves
  to the same proxy. That is why namespace imports, facades and dynamic
  imports need no special handling, and why all consumers share one wrapper
  per export (function identity is preserved across modules).
- **Consumers and real modules are never transformed.** Source maps, side
  effects, evaluation order and tree behavior are untouched. The only
  generated code is the tiny proxy.
- **Export classification at build time** (acorn on esbuild-stripped source):
  function declarations become *hoisted* wrapper functions (circular-safe,
  like the originals); unknown kinds become runtime-decided consts (functions
  get wrapped, values pass through); mutable/class exports are skipped and
  flow through the proxy's `export *` with live bindings intact.
- **Node↔browser bridge is data-only.** `mock()` calls queue serialized
  commands, flushed before `mount()` and before any call inspection. Mocks
  registered before a module loads stay pending and attach the moment the
  proxy evaluates — which is what makes dynamic imports and mount-time
  evaluation mockable. No Node callback ever runs per invocation.
- **Failures are loud.** Unknown exports list the mockable ones; ambiguous
  specifiers list all candidates (including ambiguity that only appears when
  a second matching module loads later); mocks that never attach fail the
  test at teardown with an explanation. `mockRestore()` is the deliberate
  opt-out.

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

Plugin options: `debug: true` logs every proxied module with its mockable
exports; `exclude: [/pattern/]` extends the default exclude list (React
itself, tooling); `includeNodeModules: false` restricts mocking to project
source.

## API

`mock(specifier, exportName)` returns a handle. The specifier can be a raw
import specifier (`'./api'`), a root-relative path (`'src/demo/api'`), or a
bare package name (`'clsx'`); `/index` files match their directory name.
`exportName` is a named export, `'default'`, or `'default.method'` for
default-exported objects.

Handle methods (synchronous and chainable; commands flush automatically
before `mount()` and before any call inspection):

| Method | Behavior |
|---|---|
| `mockReturnValue(v)` / `mockResolvedValue(v)` / `mockRejectedValue(e)` | serialized value/error, interpreted browser-side |
| `mockImplementation(fn)` | `fn` evaluated in the browser; must be closure-free |
| `mock*Once(...)` | once-queue, consumed before the default implementation |
| `mockClear()` | forget recorded calls |
| `mockReset()` | forget calls + implementation + once-queue; keeps spying |
| `mockRestore()` | stop mocking and recording entirely |
| `await handle.sync()` | flush queued commands now (needed when mocking *after* `mount()`) |
| `await handle.calls()` | recorded argument lists (sanitized snapshots taken at call time) |

`mock.module(specifier, { name: fn, ... })` mocks several exports at once.
A bare `mock(specifier, name)` with no implementation is a spy: it records
calls and passes through to the original.

Matchers (async — call data lives in the browser):

```ts
await expect(handle).toHaveBeenCalled()
await expect(handle).toHaveBeenCalledTimes(2)
await expect(handle).toHaveBeenCalledWith('123')
await expect(handle).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }))
await expect(handle).toHaveBeenNthCalledWith(1, 'first')
await expect(handle).toHaveBeenLastCalledWith('last')
```

## Semantics worth knowing

- **Wrappers are stable.** Cached references (`const f = foo`) see mock
  changes; mocking after `mount()` affects future calls (use `await
  handle.sync()`).
- **Calls are snapshotted at call time** (depth-capped, DOM nodes and
  functions become placeholders), so later mutation of an argument does not
  rewrite history.
- **Evaluation-time calls** (`const x = foo()` at module top level) only see
  mocks registered before the module loads — register before `mount()`.
- **`mockImplementation` sources cross the process boundary** as text: no
  closures over Node variables; the function executes in the browser.
- **Isolation** is per Playwright page/context; teardown wipes mock state, so
  context reuse and parallel workers are safe (verified by 50 parallel tests).

## Repository layout

```text
src/
  core/            browser runtime: registry, dispatch, module-id matching
  vite-plugin/     resolveId proxying, export analysis, proxy codegen
  playwright/      mock fixture, Node<->browser bridge, async matchers
  demo/            example React components used by the CT suite
playwright/        Playwright CT template
tests/
  transform/       export-analysis tests + proxy codegen golden files
  unit/            registry/dispatch/matching unit tests
  ct/              real-browser integration tests (Playwright CT, chromium)
```

## Running

```bash
npm install
npx playwright install chromium
npm test              # unit/golden tests + browser CT tests
npm run test:transform
npm run test:ct
npm run typecheck
```

Requires Node 18+ (developed on Node 24).
