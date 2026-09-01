/**
 * Browser-side runtime.
 *
 * Generated proxy modules call `__pw_module__` at evaluation time, which
 * registers the module (making it addressable by `mock()`) and returns
 * helpers that create stable wrappers around the real exports. Every wrapper
 * consults the registry per call and dispatches to the active mock or the
 * original implementation.
 *
 * The registry attaches Node-issued commands (addressed by raw specifier) to
 * canonical module ids lazily: a mock registered before its module loads
 * stays pending and attaches the moment the proxy evaluates. Validation
 * failures (unknown module at teardown, unknown export, ambiguous specifier)
 * are loud, with actionable messages.
 *
 * Served to the browser by the Vite plugin as
 * `virtual:playwright-stubs/runtime`. Must stay dependency-free apart from
 * sibling core modules.
 */

import type {
  AddressedCommand,
  DisposeReport,
  EntryState,
  ImplDescriptor,
  ModuleRegistration,
  StubStore,
} from './protocol'
import { STORE_KEY } from './protocol'
import { findModules } from './module-id'

type HandleRecord = {
  specifier: string
  exportName: string
  state: EntryState
  moduleId?: string
  errored?: boolean
  /** Ambient declaration (file-level); not reported when never attached. */
  soft?: boolean
}

function getStore(): StubStore {
  const host = globalThis as unknown as Record<string, StubStore | undefined>
  let store = host[STORE_KEY]
  if (!store) {
    store = { queue: [], errors: [] }
    host[STORE_KEY] = store
  }
  return store
}

function newState(): EntryState {
  return { impl: null, onceQueue: [], calls: [], restored: false }
}

function handleKey(specifier: string, exportName: string): string {
  return `${specifier}\u0000${exportName}`
}

function describeHandle(h: { specifier: string; exportName: string }): string {
  return `mock(${JSON.stringify(h.specifier)}, ${JSON.stringify(h.exportName)})`
}

function reviveError(error: { name: string; message: string; stack?: string }): Error {
  const revived = new Error(error.message)
  revived.name = error.name
  if (error.stack) revived.stack = error.stack
  return revived
}

const compiledImplementations = new WeakMap<object, (...args: unknown[]) => unknown>()

function toImplementation(descriptor: ImplDescriptor): (...args: unknown[]) => unknown {
  const cached = compiledImplementations.get(descriptor)
  if (cached) return cached

  let fn: (...args: unknown[]) => unknown
  switch (descriptor.type) {
    case 'returnValue':
      fn = () => descriptor.value
      break
    case 'resolvedValue':
      fn = () => Promise.resolve(descriptor.value)
      break
    case 'rejectedValue':
      fn = () => Promise.reject(reviveError(descriptor.error))
      break
    case 'implementation':
      // Indirect eval compiles in the browser's global scope. Closures over
      // Node variables cannot survive the trip -- documented limitation.
      fn = (0, eval)(`(${descriptor.fnSource})`)
      break
  }
  compiledImplementations.set(descriptor, fn)
  return fn
}

/**
 * Classes cannot be transparently wrapped by a plain function; leave them
 * untouched. Also catches transpiled classes is-not-attempted: a downleveled
 * class looks like a function and will be wrapped -- constructing it still
 * works through the `new.target` path below.
 */
function isClass(value: Function): boolean {
  return /^\s*class[\s{]/.test(Function.prototype.toString.call(value))
}

function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function invoke(
  fn: Function,
  thisArg: unknown,
  args: unknown[],
  newTarget: unknown,
): unknown {
  if (newTarget !== undefined) return Reflect.construct(fn, args, newTarget as Function)
  return Reflect.apply(fn, thisArg, args)
}

// ---------------------------------------------------------------------------
// Argument sanitization: calls are recorded as a serializable snapshot taken
// at call time, so later mutation of an argument does not rewrite history and
// page.evaluate never chokes on DOM nodes or functions.
// ---------------------------------------------------------------------------

export function sanitizeValue(value: unknown, depth = 6, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value
  const type = typeof value
  if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
    return value
  }
  if (type === 'function') {
    const name = (value as Function).name
    return `[Function${name ? `: ${name}` : ''}]`
  }
  if (type === 'symbol') return String(value)

  const obj = value as object
  if (obj instanceof Date) return new Date(obj.getTime())
  if (obj instanceof RegExp) return new RegExp(obj.source, obj.flags)
  if (obj instanceof Error) return { name: obj.name, message: obj.message }
  if (typeof Node !== 'undefined' && obj instanceof Node) {
    const tag = (obj as Node & { tagName?: string }).tagName
    return `[${tag ? `Element: ${tag.toLowerCase()}` : obj.nodeName}]`
  }
  if (obj instanceof Map) return `[Map(${obj.size})]`
  if (obj instanceof Set) return `[Set(${obj.size})]`
  if (seen.has(obj)) return '[Circular]'
  if (depth <= 0) return '[MaxDepth]'

  seen.add(obj)
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeValue(item, depth - 1, seen))
  }
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    out[key] = sanitizeValue((obj as Record<string, unknown>)[key], depth - 1, seen)
  }
  return out
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

class Registry {
  private modules = new Map<string, ModuleRegistration>()
  private byKey = new Map<string, EntryState>()
  private handles = new Map<string, HandleRecord>()

  constructor(private readonly store: StubStore) {
    store.api = {
      apply: () => this.apply(),
      getCalls: (specifier, exportName) => this.getCalls(specifier, exportName),
      reset: () => this.reset(),
    }
  }

  /** Drain the command queue; throw accumulated validation errors. */
  apply(): void {
    const errors = this.store.errors.splice(0)
    this.drain(errors)
    if (errors.length > 0) {
      throw new Error(`playwright-stubs:\n${errors.join('\n')}`)
    }
  }

  private drain(errors: string[]): void {
    const commands = this.store.queue.splice(0)
    for (const command of commands) this.command(command, errors)
  }

  private command({ specifier, exportName, command }: AddressedCommand, errors: string[]): void {
    const key = handleKey(specifier, exportName)
    let handle = this.handles.get(key)
    if (!handle) {
      handle = { specifier, exportName, state: newState(), soft: false }
      if (command.op === 'ensure') handle.soft = command.soft === true
      this.handles.set(key, handle)
      this.tryAttach(handle, errors)
    }
    const state = handle.state
    switch (command.op) {
      case 'ensure':
        // A hard ensure (test body) claims an ambient handle.
        if (command.soft !== true) handle.soft = false
        break
      case 'set':
        state.impl = command.impl
        state.restored = false
        break
      case 'push-once':
        state.onceQueue.push(command.impl)
        state.restored = false
        break
      case 'clear':
        state.calls = []
        break
      case 'reset':
        state.impl = null
        state.onceQueue = []
        state.calls = []
        break
      case 'restore':
        state.impl = null
        state.onceQueue = []
        state.restored = true
        break
    }
  }

  private tryAttach(handle: HandleRecord, errors: string[]): void {
    if (handle.moduleId || handle.errored) return
    const matches = findModules(handle.specifier, this.modules.values())
    if (matches.length === 0) return // pending; may attach when a module registers
    if (matches.length > 1) {
      handle.errored = true
      errors.push(
        `${describeHandle(handle)} is ambiguous; it matches: ` +
          `${matches.map((m) => m.id).join(', ')}. Use a more specific path.`,
      )
      return
    }

    const module = matches[0]
    const baseName = handle.exportName.split('.')[0]
    if (!module.exportNames.includes(baseName)) {
      handle.errored = true
      errors.push(
        `${describeHandle(handle)}: module "${module.id}" has no mockable export ` +
          `"${baseName}". Mockable exports: ${module.exportNames.join(', ') || '(none)'}.`,
      )
      return
    }

    const key = `${module.id}\u0000${handle.exportName}`
    const existing = this.byKey.get(key)
    if (existing) {
      // Another handle (different specifier string) targets the same export:
      // merge into one shared state so neither shadows the other.
      if (handle.state.impl) existing.impl = handle.state.impl
      existing.onceQueue.push(...handle.state.onceQueue)
      existing.calls.push(...handle.state.calls)
      if (handle.state.restored) existing.restored = true
      handle.state = existing
    } else {
      this.byKey.set(key, handle.state)
    }
    handle.moduleId = module.id
  }

  registerModule(registration: ModuleRegistration): void {
    const existing = this.modules.get(registration.id)
    if (existing) {
      for (const spec of registration.specifiers) {
        if (!existing.specifiers.includes(spec)) existing.specifiers.push(spec)
      }
    } else {
      this.modules.set(registration.id, registration)
    }
    // Deferred error reporting: this runs during module evaluation, where a
    // throw would surface as an incomprehensible page error. Errors are
    // buffered and re-thrown by the next page.evaluate touchpoint.
    const errors: string[] = []
    this.drain(errors)
    for (const handle of this.handles.values()) {
      this.tryAttach(handle, errors)
      // A handle that attached earlier may become ambiguous now that another
      // matching module has loaded; attachment order must not hide that.
      if (handle.moduleId && !handle.errored) {
        const matches = findModules(handle.specifier, this.modules.values())
        if (matches.length > 1) {
          handle.errored = true
          errors.push(
            `${describeHandle(handle)} is ambiguous; it matches: ` +
              `${matches.map((m) => m.id).join(', ')}. Use a more specific path.`,
          )
        }
      }
    }
    this.store.errors.push(...errors)
  }

  dispatch(
    moduleId: string,
    exportName: string,
    getOriginal: () => unknown,
    thisArg: unknown,
    args: unknown[],
    newTarget: unknown,
  ): unknown {
    const state = this.byKey.get(`${moduleId}\u0000${exportName}`)
    if (!state || state.restored) {
      return invoke(getOriginal() as Function, thisArg, args, newTarget)
    }

    state.calls.push(args.map((arg) => sanitizeValue(arg)))

    const descriptor = state.onceQueue.shift() ?? state.impl
    if (!descriptor) {
      return invoke(getOriginal() as Function, thisArg, args, newTarget) // spy passthrough
    }
    return invoke(toImplementation(descriptor), thisArg, args, newTarget)
  }

  getCalls(specifier: string, exportName: string): unknown[][] {
    const handle = this.handles.get(handleKey(specifier, exportName))
    if (!handle) {
      throw new Error(
        `playwright-stubs: no mock was registered for ` +
          `${describeHandle({ specifier, exportName })}.`,
      )
    }
    if (handle.errored) {
      throw new Error(
        `playwright-stubs: ${describeHandle(handle)} failed to attach; ` +
          `see the earlier error for details.`,
      )
    }
    if (!handle.moduleId) {
      throw new Error(
        `playwright-stubs: ${describeHandle(handle)} never attached to a loaded module. ` +
          `Either the mounted component never imported it, or the specifier matches ` +
          `no instrumented module. Loaded modules: ` +
          `${[...this.modules.keys()].join(', ') || '(none)'}.`,
      )
    }
    return handle.state.calls
  }

  reset(): DisposeReport {
    // Restored pending handles are a deliberate opt-out; soft (file-level
    // ambient) handles legitimately stay unused in tests that never load
    // their module. Neither is a mistake worth failing the test over.
    const pending = [...this.handles.values()]
      .filter(
        (handle) =>
          !handle.moduleId && !handle.errored && !handle.state.restored && !handle.soft,
      )
      .map(describeHandle)
    const errors = this.store.errors.splice(0)
    this.handles.clear()
    this.byKey.clear()
    this.store.queue.length = 0
    // Module registrations survive: they describe the loaded code, not test
    // state, and must stay valid when Playwright reuses the page.
    return { pending, errors }
  }
}

let singleton: Registry | null = null

function getRegistry(): Registry {
  if (!singleton) singleton = new Registry(getStore())
  return singleton
}

/** Test-only: drop all state including the global store. */
export function resetRuntimeForTests(): void {
  singleton = null
  delete (globalThis as unknown as Record<string, unknown>)[STORE_KEY]
}

// ---------------------------------------------------------------------------
// Wrapper factories used by generated proxy modules
// ---------------------------------------------------------------------------

function makeWrapper(
  registry: Registry,
  moduleId: string,
  exportName: string,
  getOriginal: () => unknown,
): Function {
  const wrapper = function (this: unknown, ...args: unknown[]) {
    return registry.dispatch(moduleId, exportName, getOriginal, this, args, new.target)
  }

  const original = getOriginal()
  Object.defineProperty(wrapper, 'name', { value: exportName, configurable: true })
  if (typeof original === 'function') {
    Object.defineProperty(wrapper, 'length', { value: original.length, configurable: true })
    // `new WrappedCtor()` constructs through Reflect.construct with the
    // wrapper as new.target; aligning prototypes keeps `instanceof` working.
    try {
      wrapper.prototype = (original as { prototype?: object }).prototype as object
    } catch {
      // read-only prototype; skip
    }
    for (const key of Object.keys(original)) {
      try {
        ;(wrapper as unknown as Record<string, unknown>)[key] = (
          original as unknown as Record<string, unknown>
        )[key]
      } catch {
        // read-only property; skip
      }
    }
  }
  ;(wrapper as { __pwOriginal?: unknown }).__pwOriginal = original
  return wrapper
}

function makeObjectProxy(
  registry: Registry,
  moduleId: string,
  exportName: string,
  target: Record<PropertyKey, unknown>,
): unknown {
  const wrapperCache = new Map<string, Function>()
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver)
      if (typeof prop !== 'string') return value
      if (typeof value !== 'function' || isClass(value as Function)) return value
      let wrapper = wrapperCache.get(prop)
      if (!wrapper) {
        wrapper = makeWrapper(registry, moduleId, `${exportName}.${prop}`, () =>
          Reflect.get(t, prop),
        )
        wrapperCache.set(prop, wrapper)
      }
      return wrapper
    },
  })
}

export type ModuleHelper = {
  /** Dispatch a call for a hoisted function-export wrapper. */
  call(exportName: string, thisArg: unknown, args: unknown[], newTarget: unknown): unknown
  /** Runtime-decided wrapping for exports of unknown kind. */
  wrap(exportName: string): unknown
  /** Raw passthrough (used for unwrappable defaults, e.g. classes). */
  raw(exportName: string): unknown
}

export function __pw_module__(
  meta: ModuleRegistration,
  real: Record<string, unknown>,
): ModuleHelper {
  const registry = getRegistry()
  registry.registerModule(meta)

  return {
    call(exportName, thisArg, args, newTarget) {
      return registry.dispatch(
        meta.id,
        exportName,
        () => real[exportName],
        thisArg,
        args,
        newTarget,
      )
    },
    wrap(exportName) {
      const value = real[exportName]
      if (typeof value === 'function' && !isClass(value)) {
        return makeWrapper(registry, meta.id, exportName, () => real[exportName])
      }
      if (exportName === 'default' && isPlainObject(value)) {
        return makeObjectProxy(registry, meta.id, exportName, value)
      }
      return value
    },
    raw(exportName) {
      return real[exportName]
    },
  }
}
