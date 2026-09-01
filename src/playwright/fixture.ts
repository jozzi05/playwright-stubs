/**
 * Node-side mock API and Playwright fixture.
 *
 * `mock()` and its configuration methods are synchronous and chainable.
 * Commands queue in Node and flush to the browser as serialized data:
 *  - automatically before `mount()` (mocks are live before module evaluation),
 *  - automatically before any call inspection (matchers, `.calls()`),
 *  - explicitly via `await handle.sync()` for post-mount reconfiguration.
 *
 * Validation is loud: unknown exports and ambiguous specifiers reject the
 * flushing call; mocks that never attach to a loaded module fail the test at
 * teardown with an explanatory message.
 *
 * No Node callback ever runs per invocation. `mockImplementation(fn)` ships
 * `fn.toString()` to the browser; it must be closure-free.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page, TestType } from '@playwright/test'
import type {
  AddressedCommand,
  ImplDescriptor,
  MockCommand,
  SerializedError,
  StubStore,
} from '../core/protocol'

declare global {
  // eslint-disable-next-line no-var
  var __PW_STUBS__: StubStore | undefined
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack }
  }
  return { name: 'Error', message: String(error) }
}

export class MockHandle {
  constructor(
    private readonly controller: MockController,
    readonly specifier: string,
    readonly exportName: string,
    ambient = false,
  ) {
    this.enqueue(ambient ? { op: 'ensure', soft: true } : { op: 'ensure' })
  }

  private enqueue(command: MockCommand): this {
    this.controller.enqueue({
      specifier: this.specifier,
      exportName: this.exportName,
      command,
    })
    return this
  }

  mockImplementation(fn: (...args: never[]) => unknown): this {
    return this.enqueue({ op: 'set', impl: { type: 'implementation', fnSource: fn.toString() } })
  }

  mockReturnValue(value: unknown): this {
    return this.enqueue({ op: 'set', impl: { type: 'returnValue', value } })
  }

  mockResolvedValue(value: unknown): this {
    return this.enqueue({ op: 'set', impl: { type: 'resolvedValue', value } })
  }

  mockRejectedValue(error: unknown): this {
    return this.enqueue({ op: 'set', impl: { type: 'rejectedValue', error: serializeError(error) } })
  }

  private enqueueOnce(impl: ImplDescriptor): this {
    return this.enqueue({ op: 'push-once', impl })
  }

  mockImplementationOnce(fn: (...args: never[]) => unknown): this {
    return this.enqueueOnce({ type: 'implementation', fnSource: fn.toString() })
  }

  mockReturnValueOnce(value: unknown): this {
    return this.enqueueOnce({ type: 'returnValue', value })
  }

  mockResolvedValueOnce(value: unknown): this {
    return this.enqueueOnce({ type: 'resolvedValue', value })
  }

  mockRejectedValueOnce(error: unknown): this {
    return this.enqueueOnce({ type: 'rejectedValue', error: serializeError(error) })
  }

  /** Forget recorded calls; keep the configured implementation. */
  mockClear(): this {
    return this.enqueue({ op: 'clear' })
  }

  /** Forget calls, implementation and the once-queue; keep spying. */
  mockReset(): this {
    return this.enqueue({ op: 'reset' })
  }

  /** Stop mocking and recording; calls go straight to the original. */
  mockRestore(): this {
    return this.enqueue({ op: 'restore' })
  }

  /** Flush queued commands to the browser (needed after `mount()`). */
  async sync(): Promise<void> {
    await this.controller.flush()
  }

  /** Recorded call argument lists (sanitized snapshots taken at call time). */
  async calls(): Promise<unknown[][]> {
    return this.controller.fetchCalls(this.specifier, this.exportName)
  }
}

export class MockController {
  private pending: AddressedCommand[] = []
  /** While true, created handles are ambient (soft) declarations. */
  ambient = false

  constructor(private readonly page: Page) {}

  enqueue(command: AddressedCommand): void {
    this.pending.push(command)
  }

  private createHandle = (specifier: string, exportName: string): MockHandle => {
    return new MockHandle(this, specifier, exportName, this.ambient)
  }

  mock: MockFunction = Object.assign(this.createHandle, {
    /**
     * Mock several exports of one module at once. Implementations run in the
     * browser and must be closure-free functions.
     */
    module: (
      specifier: string,
      implementations: Record<string, (...args: never[]) => unknown>,
    ): Record<string, MockHandle> => {
      const handles: Record<string, MockHandle> = {}
      for (const [exportName, fn] of Object.entries(implementations)) {
        if (typeof fn !== 'function') {
          throw new Error(
            `playwright-stubs: mock.module("${specifier}") supports function ` +
              `implementations only; "${exportName}" is ${typeof fn}. ` +
              `Use mock("${specifier}", "${exportName}").mockReturnValue(...) for values.`,
          )
        }
        handles[exportName] = this.createHandle(specifier, exportName).mockImplementation(fn)
      }
      return handles
    },
  })

  async flush(): Promise<void> {
    if (this.pending.length === 0) return
    const batch = this.pending
    this.pending = []
    await this.page.evaluate((commands: AddressedCommand[]) => {
      const store = (globalThis.__PW_STUBS__ ??= { queue: [], errors: [] })
      store.queue.push(...commands)
      // Apply immediately when the runtime is live; otherwise the queue
      // drains as soon as the first instrumented module evaluates.
      if (store.api) store.api.apply()
    }, batch)
  }

  async fetchCalls(specifier: string, exportName: string): Promise<unknown[][]> {
    await this.flush()
    return this.page.evaluate(
      ({ specifier, exportName }) => {
        const store = (globalThis.__PW_STUBS__ ??= { queue: [], errors: [] })
        if (!store.api) {
          throw new Error(
            `playwright-stubs: no instrumented module has loaded in this page yet; ` +
              `cannot read calls for mock(${JSON.stringify(specifier)}, ` +
              `${JSON.stringify(exportName)}). Did the test mount a component?`,
          )
        }
        store.api.apply()
        return store.api.getCalls(specifier, exportName)
      },
      { specifier, exportName },
    )
  }

  /**
   * Test teardown: wipe mock state (critical when contexts are reused) and
   * surface deferred failures -- mocks that never attached to any loaded
   * module, and validation errors nothing else reported.
   */
  async dispose(): Promise<void> {
    this.pending = []
    let report: { pending: string[]; errors: string[] } | null = null
    try {
      report = await this.page.evaluate(() => {
        const store = globalThis.__PW_STUBS__
        if (!store) return { pending: [], errors: [] }
        if (store.api) return store.api.reset()
        // Runtime never loaded: anything queued cannot have attached.
        const pending = [
          ...new Set(
            store.queue.map(
              (cmd) => `mock(${JSON.stringify(cmd.specifier)}, ${JSON.stringify(cmd.exportName)})`,
            ),
          ),
        ]
        store.queue.length = 0
        return { pending, errors: store.errors.splice(0) }
      })
    } catch {
      // Page already closed; nothing can leak from a closed page.
      return
    }

    const problems = [...report.errors]
    if (report.pending.length > 0) {
      problems.push(
        `the following mocks never attached to a loaded module: ` +
          `${report.pending.join(', ')}. Either the mounted component never imported ` +
          `the module, or the specifier matches no instrumented module.`,
      )
    }
    if (problems.length > 0) {
      throw new Error(`playwright-stubs:\n${problems.join('\n')}`)
    }
  }
}

export type MockFunction = ((specifier: string, exportName: string) => MockHandle) & {
  module(
    specifier: string,
    implementations: Record<string, (...args: never[]) => unknown>,
  ): Record<string, MockHandle>
}

/**
 * File/describe-level mock setup, the vi.mock/jest.mock analog:
 *
 *   test.use({
 *     mocks: [
 *       (mock) => {
 *         mock('./api', 'getUser').mockResolvedValue(user)
 *       },
 *     ],
 *   })
 *
 * Runs before every test in scope (each test has its own page, so "declare
 * once" necessarily means "apply per test"). Tests can still call `mock()`
 * on top; later commands win for the same export. The value is an array
 * because Playwright interprets bare function option values as fixture
 * definitions.
 */
export type MocksSetup = (mock: MockFunction) => void | Promise<void>

/** Identity helper that gives `test.use({ mocks })` full type inference. */
export function defineMocks(...setups: MocksSetup[]): MocksSetup[] {
  return setups
}

export type MockFixtures = { mock: MockFunction; mocks: MocksSetup[] | undefined }

// ---------------------------------------------------------------------------
// File-level declarations: `test.mock(...)` at the top of a test file, the
// closest analog to vi.mock/jest.mock. Declarations are recorded per test
// file at load time and auto-applied (as ambient/soft mocks) to every test in
// that file, before the `mocks` option and the test body.
// ---------------------------------------------------------------------------

type DeclaredSpec = { specifier: string; exportName: string; ops: MockCommand[] }

const declaredByFile = new Map<string, DeclaredSpec[]>()

const THIS_FILE = fileURLToPath(import.meta.url)

/** The test file that called test.mock(), from the stack (source-mapped). */
function callerFile(): string | null {
  const stack = new Error().stack?.split('\n') ?? []
  for (const line of stack) {
    const match = line.match(/\(?(?:file:\/\/)?(\/[^():]+?):\d+:\d+\)?/)
    if (!match) continue
    let file = match[1]
    try {
      file = decodeURIComponent(file)
    } catch {
      // keep raw path
    }
    const resolved = path.resolve(file)
    if (resolved === THIS_FILE) continue
    if (resolved.includes('/node_modules/') || file.startsWith('node:')) continue
    return resolved
  }
  return null
}

/** Configuration-only handle returned by `test.mock()` (no page exists yet). */
export class DeclaredMockHandle {
  constructor(private readonly ops: MockCommand[]) {}

  private push(command: MockCommand): this {
    this.ops.push(command)
    return this
  }

  mockImplementation(fn: (...args: never[]) => unknown): this {
    return this.push({ op: 'set', impl: { type: 'implementation', fnSource: fn.toString() } })
  }

  mockReturnValue(value: unknown): this {
    return this.push({ op: 'set', impl: { type: 'returnValue', value } })
  }

  mockResolvedValue(value: unknown): this {
    return this.push({ op: 'set', impl: { type: 'resolvedValue', value } })
  }

  mockRejectedValue(error: unknown): this {
    return this.push({ op: 'set', impl: { type: 'rejectedValue', error: serializeError(error) } })
  }

  mockImplementationOnce(fn: (...args: never[]) => unknown): this {
    return this.push({
      op: 'push-once',
      impl: { type: 'implementation', fnSource: fn.toString() },
    })
  }

  mockReturnValueOnce(value: unknown): this {
    return this.push({ op: 'push-once', impl: { type: 'returnValue', value } })
  }

  mockResolvedValueOnce(value: unknown): this {
    return this.push({ op: 'push-once', impl: { type: 'resolvedValue', value } })
  }

  mockRejectedValueOnce(error: unknown): this {
    return this.push({ op: 'push-once', impl: { type: 'rejectedValue', error: serializeError(error) } })
  }
}

export type DeclareMockFunction = ((specifier: string, exportName: string) => DeclaredMockHandle) & {
  module(
    specifier: string,
    implementations: Record<string, (...args: never[]) => unknown>,
  ): Record<string, DeclaredMockHandle>
}

function createDeclareApi(): DeclareMockFunction {
  const declare = (specifier: string, exportName: string): DeclaredMockHandle => {
    const file = callerFile()
    if (!file) {
      throw new Error(
        'playwright-stubs: test.mock() could not determine the calling test file; ' +
          'declare mocks directly in the test file, or use test.use({ mocks }).',
      )
    }
    let specs = declaredByFile.get(file)
    if (!specs) {
      specs = []
      declaredByFile.set(file, specs)
    }
    const spec: DeclaredSpec = { specifier, exportName, ops: [] }
    specs.push(spec)
    return new DeclaredMockHandle(spec.ops)
  }

  return Object.assign(declare, {
    module: (
      specifier: string,
      implementations: Record<string, (...args: never[]) => unknown>,
    ): Record<string, DeclaredMockHandle> => {
      const handles: Record<string, DeclaredMockHandle> = {}
      for (const [exportName, fn] of Object.entries(implementations)) {
        if (typeof fn !== 'function') {
          throw new Error(
            `playwright-stubs: test.mock.module("${specifier}") supports function ` +
              `implementations only; "${exportName}" is ${typeof fn}.`,
          )
        }
        handles[exportName] = declare(specifier, exportName).mockImplementation(fn)
      }
      return handles
    },
  })
}

const controllers = new WeakMap<MockFunction, MockController>()

/**
 * Extend a Playwright CT `test` object with the `mock` fixture, an
 * auto-flushing `mount`, and the file-level `test.mock()` declaration API.
 * Framework-agnostic: pass the `test` exported by any
 * @playwright/experimental-ct-* package.
 */
export function withMocks<TArgs extends object, WArgs extends object>(
  base: TestType<TArgs, WArgs>,
): TestType<TArgs & MockFixtures, WArgs> & { mock: DeclareMockFunction } {
  // The fixture shape (page dependency, mount override) is validated at
  // runtime by Playwright; typing it against the generic base is not worth
  // the ceremony.
  const extended = base.extend<MockFixtures>({
    mocks: [undefined, { option: true }],
    mock: async (
      { page, mocks }: { page: Page; mocks: MocksSetup[] | undefined },
      use: (mock: MockFunction) => Promise<void>,
      testInfo: { file: string },
    ) => {
      const controller = new MockController(page)
      controllers.set(controller.mock, controller)
      // Ambient layers, most general first: file-level test.mock()
      // declarations, then the `mocks` option. The test body layers on top.
      controller.ambient = true
      for (const spec of declaredByFile.get(testInfo.file) ?? []) {
        controller.mock(spec.specifier, spec.exportName)
        for (const command of spec.ops) {
          controller.enqueue({
            specifier: spec.specifier,
            exportName: spec.exportName,
            command,
          })
        }
      }
      for (const setup of mocks ?? []) await setup(controller.mock)
      controller.ambient = false
      await use(controller.mock)
      await controller.dispose()
    },
    mount: async (
      { mount, mock }: { mount: (...args: unknown[]) => unknown; mock: MockFunction },
      use: (mount: unknown) => Promise<void>,
    ) => {
      const controller = controllers.get(mock)
      await use(async (...args: unknown[]) => {
        await controller?.flush()
        return mount(...args)
      })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

  return Object.assign(extended, { mock: createDeclareApi() })
}
