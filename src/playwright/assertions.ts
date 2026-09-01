/**
 * Call-inspection matchers. Recorded calls live in the browser, so these are
 * async -- they flush pending mock commands and fetch call data on demand:
 *
 *   await expect(getUser).toHaveBeenCalledWith('123')
 *   await expect(getUser).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }))
 *
 * Argument equality supports asymmetric matchers (`expect.objectContaining`,
 * `expect.any`, ...) by delegating to their `asymmetricMatch` on the expected
 * side. (Playwright's matcher context deliberately blocks `this.equals`, so a
 * local implementation is required.)
 */

import { expect as baseExpect } from '@playwright/test'
import { MockHandle } from './fixture.js'

function isAsymmetric(value: unknown): value is { asymmetricMatch(other: unknown): boolean } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { asymmetricMatch?: unknown }).asymmetricMatch === 'function'
  )
}

function valueEquals(actual: unknown, expected: unknown): boolean {
  if (isAsymmetric(expected)) return expected.asymmetricMatch(actual)
  if (Object.is(actual, expected)) return true
  if (
    typeof actual !== 'object' ||
    typeof expected !== 'object' ||
    actual === null ||
    expected === null
  ) {
    return false
  }
  if (actual instanceof Date || expected instanceof Date) {
    return (
      actual instanceof Date && expected instanceof Date && actual.getTime() === expected.getTime()
    )
  }
  if (actual instanceof RegExp || expected instanceof RegExp) {
    return (
      actual instanceof RegExp &&
      expected instanceof RegExp &&
      String(actual) === String(expected)
    )
  }
  if (Array.isArray(actual) !== Array.isArray(expected)) return false
  const keysA = Object.keys(actual as object)
  const keysB = Object.keys(expected as object)
  if (keysA.length !== keysB.length) return false
  return keysA.every((key) =>
    valueEquals(
      (actual as Record<string, unknown>)[key],
      (expected as Record<string, unknown>)[key],
    ),
  )
}

function argsEqual(actual: unknown[], expected: unknown[]): boolean {
  if (actual.length !== expected.length) return false
  return expected.every((value, index) => valueEquals(actual[index], value))
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

function printCalls(calls: unknown[][]): string {
  if (calls.length === 0) return '(no recorded calls)'
  return calls.map((args, i) => `  ${i + 1}: ${JSON.stringify(args)}`).join('\n')
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
    const pass = calls.some((args) => argsEqual(args, expected))
    return {
      pass,
      message: () =>
        `expected ${describe(handle)} ${pass ? 'not ' : ''}to have been called with ` +
        `${JSON.stringify(expected)}\nrecorded calls:\n${printCalls(calls)}`,
    }
  },

  async toHaveBeenLastCalledWith(received: unknown, ...expected: unknown[]) {
    const handle = assertHandle(received)
    const calls = await handle.calls()
    const last = calls[calls.length - 1]
    const pass = last !== undefined && argsEqual(last, expected)
    return {
      pass,
      message: () =>
        `expected ${describe(handle)} ${pass ? 'not ' : ''}to have been last called with ` +
        `${JSON.stringify(expected)}\nrecorded calls:\n${printCalls(calls)}`,
    }
  },

  async toHaveBeenNthCalledWith(received: unknown, nth: number, ...expected: unknown[]) {
    const handle = assertHandle(received)
    const calls = await handle.calls()
    const call = calls[nth - 1]
    const pass = call !== undefined && argsEqual(call, expected)
    return {
      pass,
      message: () =>
        `expected ${describe(handle)} ${pass ? 'not ' : ''}to have been called the ` +
        `${nth}. time with ${JSON.stringify(expected)}\nrecorded calls:\n${printCalls(calls)}`,
    }
  },
})
