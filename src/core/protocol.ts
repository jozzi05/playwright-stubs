/**
 * Shared types for the Node <-> browser mock protocol.
 *
 * The Node side only ever sends plain serializable data ("descriptors" and
 * "commands") to the browser. The browser-side runtime interprets them. This
 * keeps the bridge boring: no RPC per invocation, no Node callbacks.
 *
 * The browser store has two layers:
 *  - a dumb queue (`__PW_STUBS__.queue`) that `page.evaluate` can always
 *    write to, even before any application module has loaded;
 *  - a smart API (`__PW_STUBS__.api`) installed by the runtime module once
 *    the first proxy module evaluates. It drains the queue, resolves
 *    specifiers against registered modules, validates export names and owns
 *    the dispatch state.
 */

export type SerializedError = {
  name: string
  message: string
  stack?: string
}

export type ImplDescriptor =
  | { type: 'returnValue'; value: unknown }
  | { type: 'resolvedValue'; value: unknown }
  | { type: 'rejectedValue'; error: SerializedError }
  /** Function source, evaluated once in the browser. Must be closure-free. */
  | { type: 'implementation'; fnSource: string }

/** Commands a Node-side mock handle sends to the browser registry. */
export type MockCommand =
  | { op: 'ensure' }
  | { op: 'set'; impl: ImplDescriptor }
  | { op: 'push-once'; impl: ImplDescriptor }
  | { op: 'clear' }
  | { op: 'reset' }
  | { op: 'restore' }

export type AddressedCommand = {
  /** Module specifier exactly as the test passed it to `mock()`. */
  specifier: string
  /** Export name; `default.method` addresses a default-exported object. */
  exportName: string
  command: MockCommand
}

/** Emitted into every generated proxy module by the Vite plugin. */
export type ModuleRegistration = {
  /** Canonical id: resolved path relative to the Vite root. */
  id: string
  /** Raw import specifiers observed for this module at build time. */
  specifiers: string[]
  /** Bare package name when the module lives in node_modules. */
  packageName?: string
  /** Export names that are actually wrapped (i.e. mockable). */
  exportNames: string[]
}

/** Mutable dispatch state for one mocked export. */
export type EntryState = {
  impl: ImplDescriptor | null
  onceQueue: ImplDescriptor[]
  calls: unknown[][]
  restored: boolean
}

export type DisposeReport = {
  /** Human-readable descriptions of mocks that never attached to a module. */
  pending: string[]
  errors: string[]
}

export type RegistryApi = {
  apply(): void
  getCalls(specifier: string, exportName: string): unknown[][]
  reset(): DisposeReport
}

export type StubStore = {
  queue: AddressedCommand[]
  /** Validation errors deferred from queue drains during module evaluation. */
  errors: string[]
  api?: RegistryApi
}

export const STORE_KEY = '__PW_STUBS__'
