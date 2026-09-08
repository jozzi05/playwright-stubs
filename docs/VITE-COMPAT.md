# Vite compatibility matrix

Status of `playwright-stubs` against common Vite resolution scenarios. This library is **Vite-only** — webpack/Next are out of scope.

## Module resolution

| Scenario | Status | Notes |
|---|---|---|
| Relative imports (`./api`) | covered | `tests/ct/basic.spec.tsx` |
| Root-relative path (`src/demo/api`) | covered | `tests/ct/basic.spec.tsx` |
| Vite `resolve.alias` | covered | `tests/ct/alias.spec.tsx` — mock via canonical path (`src/demo/dependency`) |
| Package imports (`clsx`, `classnames`) | covered | `tests/ct/packages.spec.tsx` — requires `vite build && vite preview` for tests (dev-server prebundling bypasses the proxy) |
| Package subpaths | planned | |
| pnpm / monorepo workspaces | planned | |
| Symlinked packages | planned | |

## ESM semantics

| Scenario | Status | Notes |
|---|---|---|
| Named exports | covered | |
| Default export (function, object) | covered | `tests/ct/default.spec.tsx` |
| Namespace imports | covered | `tests/ct/namespace.spec.tsx` |
| Re-exports / `export *` | covered | `tests/ct/reexport.spec.tsx` |
| Dynamic `import()` | covered | `tests/ct/dynamic.spec.tsx` |
| Circular dependencies | covered | `tests/ct/circular.spec.tsx` |
| `export let` live bindings | covered | `tests/ct/live-bindings.spec.tsx` |
| Classes | covered | pass-through; `tests/ct/class.spec.tsx` |
| Top-level await | planned | |

## Mock lifecycle

| Scenario | Status | Notes |
|---|---|---|
| File-level `test.mock()` | covered | |
| Per-test handle reconfiguration | covered | `tests/ct/file-level.spec.tsx` |
| Post-mount `sync()` | covered | `tests/ct/post-mount.spec.tsx` |
| Parallel worker isolation | covered | `tests/ct/isolation.spec.tsx` |
| `mockOnce` sequences | covered | `tests/ct/once.spec.tsx` |
| Test retry | planned | |

## Dev experience

| Scenario | Status | Notes |
|---|---|---|
| HMR after editing mocked module | manual | Restart dev server if proxy cache looks stale; no automated HMR test yet |
| Source maps through proxies | manual | Real module stacks are preserved; wrapper frames may appear — verify in browser DevTools |
| Plugin ordering with `@vitejs/plugin-react` | covered | `enforce: 'pre'` |

## Frameworks

| Framework | Status | Notes |
|---|---|---|
| React | covered | dogfood harness |
| Vue | documented | [examples/vue-gallery.md](./examples/vue-gallery.md) |
| Svelte | documented | [examples/svelte-gallery.md](./examples/svelte-gallery.md) |
