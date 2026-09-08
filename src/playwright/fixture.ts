/**
 * Node-side mock API and Playwright fixture.
 *
 * Declare mocks with `test.mock()` at the top of a test file. Configuration
 * methods are synchronous and chainable. Commands queue in Node and reach the
 * browser before lazy story imports evaluate:
 *  - via `page.evaluate` before `mount()` (after gallery navigation, before story import),
 *  - via `page.evaluate` when flushing after mount (matchers, `.calls()`, `sync()`).
 *
 * No Node callback ever runs per invocation. `mockImplementation(fn)` ships
 * `fn.toString()` to the browser; it must be closure-free.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page, TestType } from '@playwright/test'
import type {
  AddressedCommand,
  ImplDescriptor,
  MockCommand,
  SerializedError,
  StubStore,
} from '../core/protocol.js'

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
  /** File-level declarations replayed on every test bind. */
  private readonly replayOps: MockCommand[] = []

  constructor(
    readonly specifier: string,
    readonly exportName: string,
    private readonly ambient = false,
  ) {}

  bind(controller: MockController): void {
    controller.enqueue({
      specifier: this.specifier,
      exportName: this.exportName,
      command: { op: 'ensure', soft: this.ambient },
    })
    for (const command of this.replayOps) {
      controller.enqueue({ specifier: this.specifier, exportName: this.exportName, command })
    }
  }

  activate(): this {
    const controller = controllerStorage.getStore() ?? activeController
    if (controller) {
      controller.enqueue({
        specifier: this.specifier,
        exportName: this.exportName,
        command: { op: 'ensure', soft: false },
      })
    }
    return this
  }

  private enqueue(command: MockCommand): this {
    const controller = controllerStorage.getStore() ?? activeController
    if (!controller) {
      this.replayOps.push(command)
      return this
    }
    controller.enqueue({
      specifier: this.specifier,
      exportName: this.exportName,
      command,
    })
    return this
  }

  private configure(command: MockCommand): this {
    return this.enqueue(command)
  }

  mockImplementation(fn: (...args: never[]) => unknown): this {
    return this.configure({ op: 'set', impl: { type: 'implementation', fnSource: fn.toString() } })
  }

  mockReturnValue(value: unknown): this {
    return this.configure({ op: 'set', impl: { type: 'returnValue', value } })
  }

  mockResolvedValue(value: unknown): this {
    return this.configure({ op: 'set', impl: { type: 'resolvedValue', value } })
  }

  mockRejectedValue(error: unknown): this {
    return this.configure({ op: 'set', impl: { type: 'rejectedValue', error: serializeError(error) } })
  }

  private enqueueOnce(impl: ImplDescriptor): this {
    return this.configure({ op: 'push-once', impl })
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

  mockClear(): this {
    return this.configure({ op: 'clear' })
  }

  mockReset(): this {
    return this.configure({ op: 'reset' })
  }

  mockRestore(): this {
    return this.configure({ op: 'restore' })
  }

  async sync(): Promise<void> {
    const controller = controllerStorage.getStore() ?? activeController
    if (!controller) {
      throw new Error(
        `playwright-stubs: cannot sync mock(${JSON.stringify(this.specifier)}, ` +
          `${JSON.stringify(this.exportName)}) before the test starts.`,
      )
    }
    await controller.flush()
  }

  async calls(): Promise<unknown[][]> {
    const controller = controllerStorage.getStore() ?? activeController
    if (!controller) {
      throw new Error(
        `playwright-stubs: cannot read calls for mock(${JSON.stringify(this.specifier)}, ` +
          `${JSON.stringify(this.exportName)}) before the test starts.`,
      )
    }
    return controller.fetchCalls(this.specifier, this.exportName)
  }
}

export class MockController {
  private pending: AddressedCommand[] = []
  /** Every state transition needed to rebuild a fresh gallery document. */
  private readonly replayCommands: AddressedCommand[] = []

  constructor(private readonly page: Page) {}

  enqueue(command: AddressedCommand): void {
    this.pending.push(command)
    this.replayCommands.push(command)
  }

  private async send(commands: AddressedCommand[]): Promise<void> {
    if (commands.length === 0) return
    await this.page.evaluate((commands: AddressedCommand[]) => {
      const host = globalThis as unknown as Record<string, StubStore | undefined>
      const store = host.__PW_STUBS__ ??= { queue: [], errors: [] }
      store.queue.push(...commands)
      store.api?.apply()
    }, commands)
  }

  async flush(): Promise<void> {
    const batch = this.pending
    this.pending = []
    await this.send(batch)
  }

  /**
   * A custom mount navigates to a fresh gallery document. Re-send the complete
   * command history so mocks retain their state across multiple mount() calls.
   */
  async replay(): Promise<void> {
    this.pending = []
    await this.send(this.replayCommands)
  }

  async fetchCalls(specifier: string, exportName: string): Promise<unknown[][]> {
    await this.flush()
    return this.page.evaluate(
      ({ specifier, exportName }) => {
        const host = globalThis as unknown as Record<string, StubStore | undefined>
        const store = host.__PW_STUBS__ ??= { queue: [], errors: [] }
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

  async dispose(): Promise<void> {
    this.pending = []
    let report: { pending: string[]; errors: string[] } | null = null
    try {
      report = await this.page.evaluate(() => {
        const store = globalThis.__PW_STUBS__
        if (!store) return { pending: [], errors: [] }
        if (store.api) return store.api.reset()
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

type DeclareMockFunction = ((specifier: string, exportName: string) => MockHandle) & {
  module(
    specifier: string,
    implementations: Record<string, (...args: never[]) => unknown>,
  ): Record<string, MockHandle>
}

const handlesByFile = new Map<string, Map<string, MockHandle>>()
const controllerStorage = new AsyncLocalStorage<MockController>()
// Playwright invokes the test callback outside the fixture's AsyncLocalStorage
// scope. Keep this fallback for that runner boundary; workers still isolate
// concurrent tests, while AsyncLocalStorage covers fixture-owned async work.
let activeController: MockController | null = null
const THIS_FILE = fileURLToPath(import.meta.url)

function handleKey(specifier: string, exportName: string): string {
  return `${specifier}\0${exportName}`
}

function normalizePathForComparison(file: string): string {
  return file.replace(/\\/g, '/')
}

function callerFile(): string | null {
  const stack = new Error().stack?.split('\n') ?? []
  for (const line of stack) {
    // Node emits absolute paths in stacks, but their exact spelling varies:
    // /repo/spec.ts, C:\repo\spec.ts, and file:///C:/repo/spec.ts are all valid.
    const match = line.match(/\(?((?:file:\/\/\/?)?(?:(?:[A-Za-z]:)?[\\/])[^()]+):\d+:\d+\)?/)
    if (!match) continue
    let file: string
    try {
      file = match[1].startsWith('file:') ? fileURLToPath(match[1]) : decodeURIComponent(match[1])
    } catch {
      file = match[1]
    }
    const resolved = path.resolve(file)
    const normalized = normalizePathForComparison(resolved)
    if (normalized === normalizePathForComparison(THIS_FILE)) continue
    if (normalized.includes('/node_modules/')) continue
    return resolved
  }
  return null
}

function getOrCreateDeclaredHandle(
  file: string,
  specifier: string,
  exportName: string,
): MockHandle {
  let fileHandles = handlesByFile.get(file)
  if (!fileHandles) {
    fileHandles = new Map()
    handlesByFile.set(file, fileHandles)
  }
  const key = handleKey(specifier, exportName)
  let handle = fileHandles.get(key)
  if (!handle) {
    handle = new MockHandle(specifier, exportName, true)
    fileHandles.set(key, handle)
  }
  return handle
}

function bindFileHandles(file: string, controller: MockController): void {
  for (const handle of handlesByFile.get(file)?.values() ?? []) {
    handle.bind(controller)
  }
}

function createDeclareApi(): DeclareMockFunction {
  const declare = (specifier: string, exportName: string): MockHandle => {
    const file = callerFile()
    if (!file) {
      throw new Error(
        'playwright-stubs: test.mock() could not determine the calling test file; ' +
          'declare mocks at the top of the test file.',
      )
    }
    return getOrCreateDeclaredHandle(file, specifier, exportName)
  }

  const declareAndBind = (specifier: string, exportName: string): MockHandle => {
    const handle = declare(specifier, exportName)
    return handle.activate()
  }

  return Object.assign(declareAndBind, {
    module: (
      specifier: string,
      implementations: Record<string, (...args: never[]) => unknown>,
    ): Record<string, MockHandle> => {
      const handles: Record<string, MockHandle> = {}
      for (const [exportName, fn] of Object.entries(implementations)) {
        if (typeof fn !== 'function') {
          throw new Error(
            `playwright-stubs: test.mock.module("${specifier}") supports function ` +
              `implementations only; "${exportName}" is ${typeof fn}.`,
          )
        }
        handles[exportName] = declareAndBind(specifier, exportName).mockImplementation(fn)
      }
      return handles
    },
  })
}

type ComponentLocator = Locator & {
  update: (newProps?: Record<string, unknown>) => Promise<void>
  unmount: () => Promise<void>
}

type CallMount = (params: { story: string; props?: Record<string, unknown> }) => Promise<void>

type Mount = (storyId: string, props?: Record<string, unknown>) => Promise<ComponentLocator>

type StubsFixtures = {
  _pwStubsController: MockController
  mount: Mount
}

/**
 * Compatibility layer for Playwright's component locator shape. It is kept
 * deliberately small because withMocks must own the mount boundary in order
 * to flush mocks after gallery navigation and before the lazy story import.
 */
function createComponentLocator(
  page: Page,
  storyId: string,
  callMount: CallMount,
): ComponentLocator {
  return Object.assign(page.locator('#root'), {
    update: (newProps?: Record<string, unknown>) =>
      callMount({ story: storyId, props: newProps ?? {} }),
    unmount: () =>
      page.evaluate(async () => {
        await (window as Window & { unmount?: () => Promise<void> }).unmount?.()
      }),
  })
}

/**
 * Extend a Playwright `test` object with file-level `test.mock()` and
 * per-page mock lifecycle management.
 *
 * Playwright's built-in `mount` navigates and calls `window.mount()` atomically.
 * We mirror that contract but flush mock commands after `goto` and before
 * `window.mount()` so lazy story imports see the configured mocks.
 */
export function withMocks<TArgs extends object, WArgs extends object>(
  base: TestType<TArgs, WArgs>,
): TestType<TArgs & StubsFixtures, WArgs> & { mock: DeclareMockFunction } {
  const extended = base.extend<StubsFixtures>({
    _pwStubsController: [
      async (
        { page }: { page: Page },
        use: (controller: MockController) => Promise<void>,
        testInfo: { file: string },
      ) => {
        const controller = new MockController(page)
        activeController = controller
        await controllerStorage.run(controller, async () => {
          bindFileHandles(testInfo.file, controller)
          await use(controller)
          await controller.dispose()
        })
        activeController = null
      },
      { auto: true },
    ],
    mount: async (
      {
        page,
        baseURL,
        _pwStubsController: controller,
      }: {
        page: Page
        baseURL: string | undefined
        _pwStubsController: MockController
      },
      use: (mount: Mount) => Promise<void>,
    ) => {
      const callMount = async (params: { story: string; props?: Record<string, unknown> }) => {
        await page.evaluate(async (payload) => {
          const w = window as Window & {
            mount?: (p: { story: string; props?: Record<string, unknown> }) => Promise<void>
          }
          if (typeof w.mount !== 'function') {
            throw new Error('The gallery page does not define window.mount().')
          }
          await w.mount(payload)
        }, params)
      }

      await use(async (storyId, props) => {
        if (!baseURL) {
          throw new Error(
            'playwright-stubs: component tests require use.baseURL pointing at the gallery page.',
          )
        }
        await page.goto(baseURL)
        await controller.replay()
        await callMount({ story: storyId, props: props ?? {} })
        return createComponentLocator(page, storyId, callMount)
      })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

  return Object.assign(extended, { mock: createDeclareApi() })
}
