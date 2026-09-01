/**
 * Unit tests for the browser-side dispatch state machine (brief §84),
 * exercised directly in Node against the globalThis-backed store.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { __pw_import__ } from '../../src/core/runtime'
import type { MockEntry, StubStore } from '../../src/core/protocol'

const META = { specifier: './dependency', moduleId: 'src/demo/dependency.ts' }

function store(): StubStore {
  return (globalThis as unknown as { __PW_STUBS__: StubStore }).__PW_STUBS__
}

function addEntry(overrides: Partial<MockEntry> = {}): MockEntry {
  const entry: MockEntry = {
    specifier: './dependency',
    exportName: 'foo',
    impl: null,
    onceQueue: [],
    calls: [],
    ...overrides,
  }
  store().entries.push(entry)
  return entry
}

const original = (value: number) => value * 2

beforeEach(() => {
  ;(globalThis as unknown as { __PW_STUBS__: StubStore }).__PW_STUBS__ = { entries: [] }
})

describe('__pw_import__', () => {
  it('passes through non-functions untouched', () => {
    const value = { some: 'object' }
    expect(__pw_import__(META, 'value', value)).toBe(value)
  })

  it('passes through classes untouched', () => {
    class Foo {}
    expect(__pw_import__(META, 'Foo', Foo)).toBe(Foo)
  })

  it('returns a stable wrapper that calls the original when unmocked', () => {
    const wrapped = __pw_import__(META, 'foo', original)
    expect(wrapped).not.toBe(original)
    expect(wrapped(10)).toBe(20)
    expect(wrapped.name).toBe('foo')
  })
})

describe('dispatch', () => {
  it('records calls and passes through when no implementation is set (spy)', () => {
    const entry = addEntry()
    const wrapped = __pw_import__(META, 'foo', original)
    expect(wrapped(10)).toBe(20)
    expect(entry.calls).toEqual([[10]])
  })

  it('uses returnValue implementations', () => {
    addEntry({ impl: { type: 'returnValue', value: 999 } })
    const wrapped = __pw_import__(META, 'foo', original)
    expect(wrapped(10)).toBe(999)
  })

  it('resolves and rejects promise descriptors', async () => {
    const entry = addEntry({
      exportName: 'getUser',
      impl: { type: 'resolvedValue', value: { name: 'Alice' } },
    })
    const wrapped = __pw_import__(META, 'getUser', async (_id: string) => ({ name: 'real' }))
    await expect(wrapped('123')).resolves.toEqual({ name: 'Alice' })

    entry.impl = {
      type: 'rejectedValue',
      error: { name: 'ApiError', message: 'boom' },
    }
    await expect(wrapped('123')).rejects.toMatchObject({ name: 'ApiError', message: 'boom' })
  })

  it('consumes the once-queue before the default implementation', () => {
    addEntry({
      impl: { type: 'returnValue', value: 'default' },
      onceQueue: [
        { type: 'returnValue', value: 'first' },
        { type: 'returnValue', value: 'second' },
      ],
    })
    const wrapped = __pw_import__(META, 'foo', original)
    expect(wrapped(1)).toBe('first')
    expect(wrapped(1)).toBe('second')
    expect(wrapped(1)).toBe('default')
    expect(wrapped(1)).toBe('default')
  })

  it('falls back to the original after the once-queue drains with no default', () => {
    addEntry({ onceQueue: [{ type: 'returnValue', value: 'once' }] })
    const wrapped = __pw_import__(META, 'foo', original)
    expect(wrapped(10)).toBe('once')
    expect(wrapped(10)).toBe(20)
  })

  it('evaluates implementation source in the browser realm', () => {
    addEntry({ impl: { type: 'implementation', fnSource: '(value) => value + 1' } })
    const wrapped = __pw_import__(META, 'foo', original)
    expect(wrapped(10)).toBe(11)
  })

  it('matches by resolved module id suffix', () => {
    addEntry({ specifier: 'src/demo/dependency' })
    const wrapped = __pw_import__(META, 'foo', original)
    expect(wrapped(10)).toBe(20)
    expect(store().entries[0].calls).toEqual([[10]])
  })

  it('does not match unrelated modules', () => {
    const entry = addEntry({ specifier: './other' })
    const wrapped = __pw_import__(META, 'foo', original)
    expect(wrapped(10)).toBe(20)
    expect(entry.calls).toEqual([])
  })
})
