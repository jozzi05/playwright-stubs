# Deep analysis of the milestone-1 implementation

This document audits the shipped prototype against the design brief: what each
component does, why it was built that way, where it is strong, where it is
semantically wrong or fragile, and what to improve in which order. It is
deliberately critical — several defects below are not covered by the current
test suite.

## 1. Verdict against the brief's decision criteria (§96)

| # | Criterion | Status |
|---|---|---|
| 1 | Named function imports work reliably | **Met** — 33 CT tests green, incl. 20 parallel isolation tests (Chromium only) |
| 2 | No package allowlist | **Met** — the import statement is the configuration |
| 3 | No custom module loader | **Met** — normal Vite resolution and browser execution throughout |
| 4 | Transformation code stays small | **Met** — transform ≈150 LOC, runtime ≈130 LOC, one acorn pass, one magic-string edit |
| 5 | Source maps remain good | **Unverified** — maps are generated (`hires`), but no test inspects browser stacks or traces |
| 6 | Vite HMR not fragile | **Untested** — CT test runs don't exercise HMR |
| 7 | CJS supported cleanly or excluded | **Met by exclusion** — anything resolving into `node_modules` is skipped |
| 8 | Test isolation reliable | **Met** — per-page store, teardown wipe, parallel suite passes |
| 9 | Performance overhead negligible | **Plausible, unmeasured** — zero-mock cost is one `Array.find` over an empty array per call; no benchmark exists |
| 10 | Understandable in six months | **Met** — three small modules, data-only protocol, no metaprogramming beyond one `eval` |

None of the brief's abandonment triggers (§96, second list) fired. The core
hypothesis — import-site instrumentation + browser-side registry — is
validated for the milestone-1 scope. The rest of this document is about the
edges.

## 2. Component-by-component analysis

### 2.1 Import-site transform (`src/vite-plugin/`)

**Decision.** Run with `enforce: 'post'` so the input is plain ESM (esbuild
has already erased TypeScript and compiled JSX), parse with acorn, edit with
magic-string, rewrite only `ImportSpecifier` nodes, resolve specifiers through
`this.resolve` and skip anything landing in `node_modules`.

**Pros**

- Post-esbuild input means the parser never sees TS/JSX. Type-only imports
  (§41–42) are handled *for free* — esbuild erased them before we run. No
  `verbatimModuleSyntax` special-casing needed.
- One established parser, one string-edit library. There is no custom ESM
  logic to maintain — the exact failure mode of the previous implementation.
- `node_modules` skipping doubles as a React guard: `import { useState } from
  'react'` is never wrapped because of where it resolves, not because of a
  hardcoded name list.
- Re-exported bindings (`import { foo } ...; export { foo }`) are detected and
  left untouched, preserving live-binding semantics for downstream consumers
  (§40).

**Cons / risks**

- **Eager binding read (real semantic change).** The generated
  `const foo = __pw_import__(..., __pw_0_foo)` reads the import binding at
  consumer-evaluation time. Original code that only touches `foo` inside
  function bodies defers that read. Consequences:
  - In a circular dependency, `export function foo` is safe (function
    declarations are hoisted during module instantiation), but
    `export const foo = () => ...` from a module that is mid-evaluation is in
    TDZ → the transform converts working code into a `ReferenceError`
    (§22 warned exactly about this). Untested today.
  - **Live bindings are snapshotted.** If the dependency reassigns an
    `export let` binding, the wrapper keeps dispatching to the stale value
    (§15). For milestone-1 (function declarations) this is mostly moot, but it
    is silently wrong for mutable exports.
- **Per-import-site wrappers break cross-module identity.** Two consumer
  modules importing the same export each get a *different* wrapper function,
  so `fooFromModuleA === fooFromModuleB` is `false` where ESM guarantees
  `true` (§16 asks for "must define"; the current answer is "broken").
  Recording still converges (both dispatch to the same entry), but identity-
  sensitive code (event unsubscribe by reference across modules,
  React.memo comparisons) can misbehave.
- **Insertion point.** Wrapper `const`s are appended after each import
  statement. Imports are hoisted; the `const` is not. Top-level code placed
  *above* the import that calls `foo` (legal, works via hoisting for function
  declarations) would hit TDZ post-transform. Rare style, but a silent break.
- **Ordering assumption.** "User `post` plugins run after esbuild and before
  `vite:import-analysis`" is stable, documented-adjacent Vite behavior, but it
  is an assumption the plugin's correctness fully rests on. Playwright CT
  pins its own Vite (currently 8.x); a Rolldown-era plugin pipeline change is
  a maintenance watch-item.
- Unsupported forms (namespace, default, `export *`, dynamic import) are
  skipped **silently** at transform time unless `debug: true`. Goal J says
  fail clearly; today the failure surfaces as "the real implementation ran".

### 2.2 Module identity and matching (`src/core/module-id.ts`)

**Decision.** Registry entries are keyed by the raw string the test passed to
`mock()`. Each import site carries `{ rawSpecifier, rootRelativeResolvedId }`
and matching tries exact-specifier equality, then extension-insensitive
suffix match on the resolved id.

**Pros**

- Zero infrastructure: no manifest, no Node-side resolution, works for
  relative paths and root-relative paths, tolerates `.ts`/`.tsx` ambiguity.
- The human-facing API accepts what the human sees in the import statement
  (§54's requirement).

**Cons / risks**

- **Ambiguity by construction.** `mock('./dependency', 'foo')` matches *any*
  instrumented module whose resolved id ends in `/dependency`. Two files with
  the same basename in different directories are both mocked. §57 recommends
  keying by resolved identity; the current design approximates it with a
  suffix heuristic.
- **Index-module blind spot.** `mock('./api')` against `src/api/index.ts`
  never matches (`src/api/index` does not end with `/api`). Combined with the
  next point, this is the worst DX trap in the prototype.
- **Silent no-match.** If the specifier matches nothing — typo, index module,
  unsupported import form — the test just runs the real implementation and
  fails later at an assertion with no hint. This directly violates Goal J and
  §88's diagnostics requirement. There is no "mock never attached" signal.
- **Duplicate entries for aliased specifiers.** `mock('./dependency', 'foo')`
  and `mock('src/demo/dependency', 'foo')` in one test create two entries;
  dispatch uses the *first* match, so the second handle records nothing and
  its configuration is shadowed. Confusing and undiagnosed (§56–57 warned).

### 2.3 Browser runtime (`src/core/runtime.ts`)

**Decision.** A dumb data store (`globalThis.__PW_STUBS__`, plain JSON-shaped
entries) plus an interpreter. Wrappers are plain functions (no Proxy, §73)
that run the §84 state machine per call: find entry → record → once-queue →
implementation → original. Implementations arrive as descriptors; function
sources are compiled once via indirect `eval` and cached in a `WeakMap`.

**Pros**

- The store can be created by *either* side (`??=`) in any order, which
  eliminated the need for `addInitScript` entirely — one less lifecycle to
  reason about, and mock registration genuinely does not import the module
  (§23 requirement holds by construction).
- Sync/async transparency (§31): dispatch never awaits; a sync mock of a sync
  function stays sync.
- Spy-for-free (§83): entry-with-no-implementation records and passes
  through — one abstraction, exactly as the brief hoped.
- `this` is forwarded through `apply` (§17), and stable wrappers make cached
  references (`const cached = foo`) behave (§16, tested in post-mount spec).
- Zero-mock overhead is a single `find` over an (almost always empty) array.

**Cons / risks**

- **Constructor functions break.** Classes are detected via a
  `Function.prototype.toString` sniff and passed through, but an old-style
  constructor function (`function Point(x){this.x=x}`) gets wrapped, and
  `new wrappedPoint()` returns the dispatch result, not a `Point`. The
  toString sniff also fails for classes downleveled to functions by a lower
  build target. `Reflect.construct` support in the wrapper (or a
  `new.target` check) would fix this cheaply.
- **`eval` dependency.** Browser-side implementations require an
  eval-permitting environment. The CT harness page allows it, but any future
  strict-CSP embedding breaks `mockImplementation` (not the value-based
  mocks). Worth documenting; not worth fixing now.
- **Closure capture is undetected.** `mockImplementation(fn)` ships
  `fn.toString()`; a closure over a Node variable becomes a bare
  `ReferenceError` in the browser at call time with no hint that the variable
  crossed a process boundary. A free-variable scan at enqueue time (acorn is
  already a dependency) could turn this into a mock-time error.
- **Recorded arguments are live references**, serialized only when fetched.
  An object mutated after the call is asserted against its *current* state.
  Jest shares this flaw, but Jest users know it; here the JSON round-trip
  adds a second distortion (`Date` → string, `Map`/`Set` → `{}`, nested
  `undefined` dropped).
- Matching cost per call is a linear scan with regex work in
  `normalizeModuleId`. Irrelevant at test scale; trivially cacheable if a hot
  render loop ever makes it visible.

### 2.4 Node↔browser bridge and fixture (`src/playwright/fixture.ts`)

**Decision.** `mock()` and all configuration methods are synchronous and
chainable (matching the brief's example API verbatim). Commands queue in Node
as pure data and flush in one `page.evaluate` before `mount()` (via a `mount`
fixture override), before any call fetch, or explicitly via `await sync()`.
Teardown wipes the store.

**Pros**

- The brief's ergonomics survive contact with reality — no `await` on
  `mockReturnValue`, no per-invocation RPC (§28 fully honored), and one
  round-trip per test in the common case.
- Serialized-data protocol means the browser never calls back into Node:
  no async-only contamination, no serialization surprises mid-test, easy to
  reason about in traces.
- Teardown wipe + per-context store gives isolation that held up under
  parallel workers, and stays correct under CT context reuse (§33–34).

**Cons / risks**

- **The flush model has a sharp edge.** A mock configured *after* `mount()`
  is inert until *something* flushes — and the next flusher might be an
  unrelated matcher, applying the pending mock at a surprising moment
  mid-test. `await handle.sync()` exists, but forgetting it produces
  action-at-a-distance rather than an error. Options: auto-flush every
  enqueue on a microtask (simple, slightly chattier), or track
  "enqueued after mount" and fail the test at teardown if never flushed.
- **The controller is smuggled through a `WeakMap`** keyed by the fixture
  function, and the `mount` override is typed away with `as any`. Runtime-
  correct, but the least honest code in the repo; a `mockController` fixture
  that `mock` and `mount` both depend on would express the same wiring in
  Playwright's own dependency system.
- `mockRejectedValue` on a component without rejection handling surfaces as
  an unhandled `pageerror`, which fails the test with a stack pointing
  nowhere near the mock. A note in diagnostics (or wrapping the revived error
  with origin info) would soften this.
- Handles targeting the same entry via different specifier strings interact
  badly (see 2.2, duplicate entries).

### 2.5 Assertions (`src/playwright/assertions.ts`)

**Decision.** Async custom matchers (`toHaveBeenCalled`, `...Times`,
`...With`) on an extended `expect`, fetching calls on demand; a local
`deepEqual` for argument comparison.

**Pros**

- Async matchers are the honest shape: call data lives in another process.
  `await expect(foo).toHaveBeenCalledWith(10)` is one character-class away
  from Jest and consistent with Playwright's web-first assertions.
- Matchers flush pending commands, so assertion-time state is always the
  configured state.

**Cons / risks**

- **`deepEqual` is naive and has a real bug**: two `Date`s (or `RegExp`s)
  with different values compare *equal* (both have no enumerable keys). It
  also supports none of `expect.objectContaining` / asymmetric matchers,
  which are the first thing users reach for with big payloads. Fix: delegate
  to the matcher context's `this.equals` (Playwright's expect exposes the
  Jasmine-style equality with asymmetric-matcher support) and delete the
  local implementation.
- Extending `expect` **shadows** the built-in Jest-mock matchers of the same
  names for that import; a file mixing real `jest.fn()`-style mocks and these
  handles loses the built-ins. Naming (`toHaveBeenCalledOnPage`?) was
  considered and rejected for ergonomics; the trade-off should at least be
  documented.
- No `toHaveBeenNthCalledWith` / `toHaveBeenLastCalledWith`; trivial adds on
  the existing `calls()` plumbing.

### 2.6 Test strategy

**Pros**

- The two-layer structure the brief demanded (§92) exists and pays off:
  golden files catch transform regressions at a glance; the state machine is
  unit-tested without a browser; CT proves the integrated stack.
- The §102 acceptance scenario is implemented verbatim, including the
  mocked/unmocked pair under parallel execution.

**Cons / gaps** (equivalently: brief experiments not yet run)

- No circular-dependency fixture (Experiment 8) — the eager-read risk in 2.1
  is exactly what it would catch.
- No source-map verification (§45): nothing asserts that a thrown error's
  stack points at original source.
- No HMR test (Experiment 10), no performance measurement (§71), no
  cross-browser projects (webkit/firefox), no CI workflow.
- Dependency-optimization survival (Experiment 2) is *dodged*, not answered:
  `node_modules` is skipped wholesale, so milestone 3's core question is
  untouched.
- Isolation runs 20 parallel tests; the brief suggests up to 100 with
  distinct values. Cheap to scale.

## 3. Semantic-correctness matrix (current truth)

| ESM case | Current behavior | Correct? |
|---|---|---|
| `import { foo }` (function decl) | wrapped, dispatched | yes |
| `import { foo as bar }` | wrapped, keyed by exported name | yes |
| `import def, { foo }` | named wrapped, default untouched | yes (v1 scope) |
| `import * as ns` / `import def` | untouched, unmockable | by design, but silent |
| `import type { T }` | erased before plugin runs | yes |
| unused import | wrapped (dead const) | harmless in tests |
| `export { foo }` of imported binding | skipped, stays live | yes |
| `export let` reassignment in dep | **wrapper goes stale** | **no (silent)** |
| circular dep, `export function` | safe (hoisted) | yes |
| circular dep, `export const fn = ...` | **possible TDZ at consumer eval** | **no (loud but mysterious)** |
| cross-module function identity | **wrappers differ per import site** | **no (silent)** |
| `new WrappedConstructorFn()` | **broken result** | **no (silent)** |
| `class` export | passthrough, unmockable | by design |
| `React.memo`/`forwardRef` object exports | passthrough (not functions) | yes |
| module top-level call at eval time | mock must pre-exist; mount-flush makes this work | yes, documented (§51–52) |

## 4. Prioritized improvements

### P0 — correctness and "fail clearly" (do before any scope expansion)

1. **Mock-time diagnostics via a plugin-emitted manifest.** The plugin
   already knows every instrumented `(moduleId, exportName)`; emit that
   through a virtual module or dev-server endpoint, have the fixture validate
   `mock()` targets against it, and fail immediately with the §88-style
   message ("no instrumented module matches './api'; nearest:
   `src/api/index.ts`; unsupported forms found: namespace import at
   `Profile.tsx:4`"). This one change converts the three worst silent
   failures (no-match, index modules, unsupported forms) into instant,
   actionable errors — and enables canonicalizing specifiers at registration,
   which also fixes the duplicate-entry shadowing.
2. **Lazy binding access.** Pass `() => __pw_0_foo` instead of the binding
   value into `__pw_import__` (keep an eager `typeof` probe in a `try` for the
   passthrough decision, falling back to "wrap" on TDZ). Restores live-binding
   semantics and removes the circular-dependency TDZ regression at ~zero cost.
3. **Shared wrapper cache** in the runtime keyed by resolved module id +
   export name, restoring cross-module function identity.
4. **Replace `deepEqual` with the matcher context's `equals`** (fixes the
   Date/RegExp bug, gains asymmetric matchers for free).
5. **Constructor safety**: `new.target` check in the wrapper →
   `Reflect.construct(original, args, new.target)`.

### P1 — developer experience

6. Auto-flush (microtask) or teardown-verified flush for post-`mount`
   configuration; keep `sync()` as an explicit escape hatch.
7. Free-variable scan of `mockImplementation` sources at enqueue time; error
   in Node with the captured names instead of a browser `ReferenceError`.
8. Structured-clone-based argument snapshotting at call time (fixes both the
   live-reference and the JSON-distortion problems) with a size cap.
9. Golden fixtures for circular deps, `export let`, top-level-call timing; a
   CT test that asserts an error stack maps to original source; scale the
   isolation suite to ~100 tests; add webkit/firefox projects and CI.
10. Express the fixture wiring as a real `mockController` fixture; delete the
    `WeakMap` and the `as any`.

### P2 — scope expansion (milestones 2–3, in order of leverage)

11. **Namespace imports** via a Proxy over the namespace object (§11 — the
    one place Proxy is natural): `get` returns the shared wrapper for
    function members. This is the cheapest large ergonomic win.
12. **Default exports**: function defaults are nearly identical to named
    wrapping; object defaults need the §18 Proxy design and should stay a
    separate, explicitly-scoped feature.
13. **Workspace packages**: likely works already when the package resolves to
    workspace *source* (not `node_modules`); needs fixtures to prove it
    (§26 calls this the easiest expansion — it should be next).
14. **npm packages / dependency optimization**: the honest open question.
    The plausible path that avoids the old allowlist trap is virtual-module
    interception at `resolveId` for *bare specifiers the test actually asked
    to mock* (lazily, per registered mock, not for every package) — wrapping
    re-exports at the boundary rather than rewriting package internals. This
    must be prototyped against pre-bundled CJS before committing (§24–25,
    §76–77).
15. Explicitly out unless demanded: `export *`, dynamic import interception,
    internal lexical calls (§7's boundary should remain a documented
    contract, not a roadmap item).

## 5. Alternatives revisited (why not the other architectures)

- **Virtual-module interception for everything (§76–77)** would fix
  cross-module identity and re-export chains centrally, but reintroduces the
  package-shaped problem: the virtual layer must faithfully reproduce every
  module's export surface (live bindings, CJS interop, cycles). As a
  *targeted* mechanism for bare-specifier mocks (P2 #14) it is attractive; as
  the primary mechanism it recreates the old implementation's failure mode.
- **Browser-side Proxy only (§78)** cannot intercept named ESM bindings —
  the brief predicted it, and nothing in this implementation contradicts
  that. Correctly rejected.
- **Service injection (§79)** remains rejected: the entire value proposition
  is mocking without restructuring application code.
- **Replacing the function object on mock registration** (instead of stable
  wrappers) was never viable: cached references and post-mount mocking — both
  now covered by passing tests — depend on stable identity.

## 6. Bottom line

The prototype proves the brief's central hypothesis at milestone-1 scope with
a genuinely small transformation layer, and the architecture has no dead ends
visible from here. Its real debts are (a) **silent failure modes** — no-match
mocks, index modules, unsupported forms, stale live bindings — which are all
addressable with one manifest-driven diagnostics pass plus a lazy-binding
tweak, and (b) **unrun experiments** — circular deps, source maps, HMR,
dependency optimization — which are cheap fixtures away from being answered.
Do P0 before widening scope: every P2 feature multiplies the cost of the
silent failures if they are still silent.
