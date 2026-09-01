/**
 * Call-inspection matchers (brief Goal H).
 *
 * Recorded calls live in the browser, so these matchers are async -- they
 * flush pending mock commands and fetch call data on demand:
 *
 *   await expect(getUser).toHaveBeenCalledWith('123')
 */

import { expect as baseExpect } from '@playwright/test'
import { MockHandle } from './fixture'

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keysA = Object.keys(a as object)
  const keysB = Object.keys(b as object)
  if (keysA.length !== keysB.length) return false
  return keysA.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  )
}

function describe(handle: MockHandle): string {
  return `mock(${JSON.stringify(handle.specifier)}, ${JSON.stringify(handle.exportName)})`
}

function assertHandle(received: unknown): MockHandle {
  if (received instanceof MockHandle) return received
  throw new Error(
    'This matcher only supports mock handles created by the playwright-stubs `mock` fixture.',
  )
}

export const expect = baseExpect.extend({
  async toHaveBeenCalled(received: unknown) {
    const handle = assertHandle(received)
    const calls = await handle.calls()
    return {
      pass: calls.length > 0,
      message: () =>
        `expected ${describe(handle)} ${calls.length > 0 ? 'not ' : ''}to have been called` +
        (calls.length > 0 ? `, but it was called ${calls.length} time(s)` : ''),
    }
  },

  async toHaveBeenCalledTimes(received: unknown, expected: number) {
    const handle = assertHandle(received)
    const calls = await handle.calls()
    return {
      pass: calls.length === expected,
      message: () =>
        `expected ${describe(handle)} to have been called ${expected} time(s), ` +
        `but it was called ${calls.length} time(s)`,
    }
  },

  async toHaveBeenCalledWith(received: unknown, ...expected: unknown[]) {
    const handle = assertHandle(received)
    const calls = await handle.calls()
    const pass = calls.some((args) => deepEqual(args, expected))
    return {
      pass,
      message: () =>
        `expected ${describe(handle)} ${pass ? 'not ' : ''}to have been called with ` +
        `${JSON.stringify(expected)}\nrecorded calls: ${JSON.stringify(calls)}`,
    }
  },
})
