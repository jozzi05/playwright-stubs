/**
 * Shared types for the Node <-> browser mock protocol.
 *
 * The Node side only ever sends plain serializable data ("descriptors") to the
 * browser. The browser-side runtime interprets descriptors at call time. This
 * keeps the bridge boring: no RPC per invocation, no Node callbacks.
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

/**
 * One mocked export. Created lazily from the Node side; consulted by every
 * instrumented wrapper on every call.
 */
export type MockEntry = {
  /** Module specifier exactly as the test passed it to `mock()`. */
  specifier: string
  exportName: string
  impl: ImplDescriptor | null
  onceQueue: ImplDescriptor[]
  calls: unknown[][]
}

export type StubStore = {
  entries: MockEntry[]
}

/**
 * Identity of an import site, embedded into transformed source by the Vite
 * plugin. `specifier` is the raw string from the import statement; `moduleId`
 * is the Vite-resolved id relative to the project root (query stripped).
 */
export type ImportMeta_ = {
  specifier: string
  moduleId: string
}

/** Commands the Node-side mock handle sends to the browser registry. */
export type MockCommand =
  | { op: 'ensure' }
  | { op: 'set'; impl: ImplDescriptor }
  | { op: 'push-once'; impl: ImplDescriptor }
  | { op: 'clear' }
  | { op: 'reset' }
  | { op: 'restore' }

export type AddressedCommand = {
  specifier: string
  exportName: string
  command: MockCommand
}

export const STORE_KEY = '__PW_STUBS__'
