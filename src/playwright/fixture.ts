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
      const host = globalThis as unknown as Record<string, StubStore | undefined>
      const store = host.__PW_STUBS__ ??= { queue: [], errors: [] }
      store.queue.push(...commands)
      store.api?.apply()
    }, batch)
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
let activeController: MockController | null = null
const THIS_FILE = fileURLToPath(import.meta.url)

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
    const controller = controllerStorage.getStore() ?? activeController
    if (controller) handle.bind(controller)
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
      use: (
        mount: (storyId: string, props?: Record<string, unknown>) => Promise<unknown>,
      ) => Promise<void>,
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
        await controller.flush()
        await callMount({ story: storyId, props: props ?? {} })
        return Object.assign(page.locator('#root'), {
          update: (newProps?: Record<string, unknown>) =>
            callMount({ story: storyId, props: newProps ?? {} }),
          unmount: () =>
            page.evaluate(async () => {
              await (window as Window & { unmount?: () => Promise<void> }).unmount?.()
            }),
        })
      })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

  return Object.assign(extended, { mock: createDeclareApi() })
}
