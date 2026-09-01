/**
 * Browser-side runtime. Every instrumented import site routes through
 * `__pw_import__`, which returns a stable wrapper. The wrapper consults the
 * stub store on each call and dispatches to the active mock or the original
 * implementation (brief: "stable wrappers", "runtime dispatch").
 *
 * This module is served to the browser by the Vite plugin under the
 * `virtual:playwright-stubs/runtime` specifier. It must stay dependency-free
 * apart from sibling core modules.
 */

import type { ImplDescriptor, ImportMeta_, MockEntry, StubStore } from './protocol'
import { STORE_KEY } from './protocol'
import { moduleMatches } from './module-id'

function getStore(): StubStore {
  const host = globalThis as unknown as Record<string, StubStore | undefined>
  let store = host[STORE_KEY]
  if (!store) {
    store = { entries: [] }
    host[STORE_KEY] = store
  }
  return store
}

function findEntry(meta: ImportMeta_, exportName: string): MockEntry | undefined {
  return getStore().entries.find(
    (entry) => entry.exportName === exportName && moduleMatches(entry.specifier, meta),
  )
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
      // The Node side sends fn.toString(); indirect eval compiles it in the
      // browser's global scope. Closures over Node variables cannot survive
      // this trip -- documented limitation.
      fn = (0, eval)(`(${descriptor.fnSource})`)
      break
  }
  compiledImplementations.set(descriptor, fn)
  return fn
}

function dispatch(
  meta: ImportMeta_,
  exportName: string,
  original: Function,
  thisArg: unknown,
  args: unknown[],
): unknown {
  const entry = findEntry(meta, exportName)
  if (!entry) return original.apply(thisArg, args)

  entry.calls.push(args)

  const descriptor = entry.onceQueue.shift() ?? entry.impl
  if (!descriptor) return original.apply(thisArg, args) // spy passthrough

  return toImplementation(descriptor).apply(thisArg, args)
}

/**
 * Classes cannot be transparently wrapped by a plain function (call without
 * `new` throws), so v1 leaves them untouched.
 */
function isClass(value: Function): boolean {
  return /^\s*class[\s{]/.test(Function.prototype.toString.call(value))
}

export function __pw_import__<T>(meta: ImportMeta_, exportName: string, original: T): T {
  if (typeof original !== 'function' || isClass(original)) return original

  const wrapper = function (this: unknown, ...args: unknown[]) {
    return dispatch(meta, exportName, original as Function, this, args)
  }

  Object.defineProperty(wrapper, 'name', { value: exportName, configurable: true })
  Object.defineProperty(wrapper, 'length', { value: original.length, configurable: true })
  // Best-effort: static properties (e.g. displayName on function components).
  for (const key of Object.keys(original)) {
    try {
      ;(wrapper as unknown as Record<string, unknown>)[key] = (
        original as unknown as Record<string, unknown>
      )[key]
    } catch {
      // read-only property; skip
    }
  }
  ;(wrapper as { __pwOriginal?: unknown }).__pwOriginal = original

  return wrapper as T
}
