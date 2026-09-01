/**
 * Node-side mock API and Playwright fixture.
 *
 * Ergonomics follow the brief: `mock()` and its configuration methods are
 * synchronous and chainable. Commands are queued in Node and flushed to the
 * browser registry as serialized data:
 *   - automatically before `mount()` (so mocks are live before the component
 *     module evaluates),
 *   - automatically before any call-inspection (matchers, `.calls()`),
 *   - explicitly via `await handle.sync()` for post-mount reconfiguration.
 *
 * No Node callback ever runs per invocation (brief §28).
 * `mockImplementation(fn)` ships `fn.toString()` to the browser; the function
 * must therefore be closure-free and is executed browser-side.
 */

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
  ) {
    this.enqueue({ op: 'ensure' })
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

  /** Remove the registry entry entirely; calls go straight to the original. */
  mockRestore(): this {
    return this.enqueue({ op: 'restore' })
  }

  /** Flush queued commands to the browser (needed after `mount()`). */
  async sync(): Promise<void> {
    await this.controller.flush()
  }

  /** Recorded call argument lists, fetched from the browser. */
  async calls(): Promise<unknown[][]> {
    return this.controller.fetchCalls(this.specifier, this.exportName)
  }
}

export class MockController {
  private pending: AddressedCommand[] = []

  constructor(private readonly page: Page) {}

  enqueue(command: AddressedCommand): void {
    this.pending.push(command)
  }

  mock = (specifier: string, exportName: string): MockHandle => {
    return new MockHandle(this, specifier, exportName)
  }

  async flush(): Promise<void> {
    if (this.pending.length === 0) return
    const batch = this.pending
    this.pending = []
    await this.page.evaluate((commands: AddressedCommand[]) => {
      const store = (globalThis.__PW_STUBS__ ??= { entries: [] })
      for (const { specifier, exportName, command } of commands) {
        const index = store.entries.findIndex(
          (entry) => entry.specifier === specifier && entry.exportName === exportName,
        )
        if (command.op === 'restore') {
          if (index !== -1) store.entries.splice(index, 1)
          continue
        }
        let entry = index === -1 ? null : store.entries[index]
        if (!entry) {
          entry = { specifier, exportName, impl: null, onceQueue: [], calls: [] }
          store.entries.push(entry)
        }
        switch (command.op) {
          case 'set':
            entry.impl = command.impl
            break
          case 'push-once':
            entry.onceQueue.push(command.impl)
            break
          case 'clear':
            entry.calls = []
            break
          case 'reset':
            entry.impl = null
            entry.onceQueue = []
            entry.calls = []
            break
          case 'ensure':
            break
        }
      }
    }, batch)
  }

  async fetchCalls(specifier: string, exportName: string): Promise<unknown[][]> {
    await this.flush()
    return this.page.evaluate(
      ({ specifier, exportName }) => {
        const store = globalThis.__PW_STUBS__
        const entry = store?.entries.find(
          (candidate) =>
            candidate.specifier === specifier && candidate.exportName === exportName,
        )
        if (!entry) return []
        // Round-trip through JSON so non-serializable arguments degrade
        // gracefully instead of failing the evaluate call.
        return entry.calls.map((args) =>
          args.map((arg) => {
            try {
              return arg === undefined ? undefined : JSON.parse(JSON.stringify(arg))
            } catch {
              return '[unserializable]'
            }
          }),
        )
      },
      { specifier, exportName },
    )
  }

  /** Test teardown: wipe the registry (critical when contexts are reused). */
  async dispose(): Promise<void> {
    this.pending = []
    try {
      await this.page.evaluate(() => {
        const store = globalThis.__PW_STUBS__
        if (store) store.entries.length = 0
      })
    } catch {
      // Page already closed; nothing can leak from a closed page.
    }
  }
}

export type MockFunction = (specifier: string, exportName: string) => MockHandle

export type MockFixtures = { mock: MockFunction }

const controllers = new WeakMap<MockFunction, MockController>()

/**
 * Extend a Playwright CT `test` object with the `mock` fixture and an
 * auto-flushing `mount`. Framework-agnostic: pass the `test` exported by any
 * @playwright/experimental-ct-* package.
 */
export function withMocks<TArgs extends object, WArgs extends object>(
  base: TestType<TArgs, WArgs>,
): TestType<TArgs & MockFixtures, WArgs> {
  // The fixture shape (page dependency, mount override) is validated at
  // runtime by Playwright; typing it against the generic base is not worth
  // the ceremony for a prototype.
  return base.extend<MockFixtures>({
    mock: async ({ page }: { page: Page }, use: (mock: MockFunction) => Promise<void>) => {
      const controller = new MockController(page)
      controllers.set(controller.mock, controller)
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
}
