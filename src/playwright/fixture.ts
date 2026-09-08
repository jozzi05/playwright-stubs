/**
 * Node-side mock API and Playwright fixture.
 *
 * Declare mocks with `test.mock()` at the top of a test file. Configuration
 * methods are synchronous and chainable. Commands queue in Node and flush to
 * the browser as serialized data:
 *  - automatically before `mount()` (mocks are live before module evaluation),
 *  - automatically before any call inspection (matchers, `.calls()`),
 *  - explicitly via `await handle.sync()` for post-mount reconfiguration.
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
  private controller: MockController | null
  private readonly preBindQueue: MockCommand[] = []
  /** File-level declarations replayed on every test bind. */
  private readonly replayOps: MockCommand[] = []

  constructor(
    controller: MockController | null,
    readonly specifier: string,
    readonly exportName: string,
    private readonly ambient = false,
  ) {
    this.controller = controller
  }

  bind(controller: MockController): void {
    this.controller = controller
    this.enqueue({ op: 'ensure', soft: this.ambient })
    for (const command of this.replayOps) {
      this.enqueue(command)
    }
    for (const command of this.preBindQueue.splice(0)) {
      this.enqueue(command)
    }
  }

  private enqueue(command: MockCommand, replay = false): this {
    if (!this.controller) {
      if (replay) {
        this.replayOps.push(command)
      } else {
        this.preBindQueue.push(command)
      }
      return this
    }
    this.controller.enqueue({
      specifier: this.specifier,
      exportName: this.exportName,
      command,
    })
    return this
  }

  private configure(command: MockCommand): this {
    return this.enqueue(command, !this.controller)
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
    if (!this.controller) {
      throw new Error(
        `playwright-stubs: cannot sync mock(${JSON.stringify(this.specifier)}, ` +
          `${JSON.stringify(this.exportName)}) before the test starts.`,
      )
    }
    await this.controller.flush()
  }

  async calls(): Promise<unknown[][]> {
    if (!this.controller) {
      throw new Error(
        `playwright-stubs: cannot read calls for mock(${JSON.stringify(this.specifier)}, ` +
          `${JSON.stringify(this.exportName)}) before the test starts.`,
      )
    }
    return this.controller.fetchCalls(this.specifier, this.exportName)
  }
}

export class MockController {
  private pending: AddressedCommand[] = []

  constructor(private readonly page: Page) {}

  enqueue(command: AddressedCommand): void {
    this.pending.push(command)
  }

  async flush(): Promise<void> {
    if (this.pending.length === 0) return
    const batch = this.pending
    this.pending = []
    await this.page.evaluate((commands: AddressedCommand[]) => {
      const store = (globalThis.__PW_STUBS__ ??= { queue: [], errors: [] })
      store.queue.push(...commands)
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
const THIS_FILE = fileURLToPath(import.meta.url)
let activeController: MockController | null = null

function handleKey(specifier: string, exportName: string): string {
  return `${specifier}\0${exportName}`
}

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
    handle = new MockHandle(null, specifier, exportName, true)
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
    if (activeController) handle.bind(activeController)
    return handle
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

type StubsFixtures = {
  _pwStubsController: MockController
}

/**
 * Extend a Playwright `test` object with file-level `test.mock()`, an
 * auto-flushing `mount`, and per-page mock lifecycle management.
 *
 * Works with Playwright 1.62+ gallery component testing (`@playwright/test`).
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
        bindFileHandles(testInfo.file, controller)
        await use(controller)
        activeController = null
        await controller.dispose()
      },
      { auto: true },
    ],
    mount: async (
      { page, _pwStubsController: controller, baseURL }: {
        page: Page
        _pwStubsController: MockController
        baseURL: string | undefined
      },
      use: (mount: (story: string, props?: Record<string, unknown>) => Promise<unknown>) => Promise<void>,
    ) => {
      await use(async (story: string, props?: Record<string, unknown>) => {
        if (!baseURL) {
          throw new Error('playwright-stubs: component tests require use.baseURL pointing at the gallery page.')
        }
        await page.goto(baseURL)
        await controller.flush()
        await page.evaluate(
          ({ story, props }) => {
            return (window as unknown as { mount: (p: { story: string; props?: Record<string, unknown> }) => Promise<void> }).mount({ story, props })
          },
          { story, props: props ?? {} },
        )
        return page.locator('#root')
      })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

  return Object.assign(extended, { mock: createDeclareApi() })
}
