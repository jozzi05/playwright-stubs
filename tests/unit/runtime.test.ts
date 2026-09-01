/**
 * Unit tests for the browser-side registry: command draining, pending
 * attachment, validation, dispatch state machine, wrapper semantics and
 * argument sanitization -- exercised directly in Node.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { __pw_module__, resetRuntimeForTests, sanitizeValue } from '../../src/core/runtime'
import type { AddressedCommand, MockCommand, StubStore } from '../../src/core/protocol'

function store(): StubStore {
  return (globalThis as unknown as { __PW_STUBS__: StubStore }).__PW_STUBS__
}

function send(specifier: string, exportName: string, ...commands: MockCommand[]): void {
  const s = ((globalThis as unknown as { __PW_STUBS__?: StubStore }).__PW_STUBS__ ??= {
    queue: [],
    errors: [],
  })
  const effective: MockCommand[] = commands.length ? commands : [{ op: 'ensure' }]
  const addressed: AddressedCommand[] = effective.map((command) => ({
    specifier,
    exportName,
    command,
  }))
  s.queue.push(...addressed)
  s.api?.apply()
}

const DEP_META = {
  id: 'src/demo/dependency.ts',
  specifiers: ['./dependency'],
  exportNames: ['foo'],
}

function registerDependency(real: Record<string, unknown> = { foo: (v: number) => v * 2 }) {
  return __pw_module__(DEP_META, real)
}

beforeEach(() => {
  resetRuntimeForTests()
})

describe('dispatch state machine', () => {
  it('passes through and does not record without a mock', () => {
    const m = registerDependency()
    expect(m.call('foo', undefined, [10], undefined)).toBe(20)
  })

  it('records calls and passes through for a bare mock (spy)', () => {
    const m = registerDependency()
    send('./dependency', 'foo')
    expect(m.call('foo', undefined, [10], undefined)).toBe(20)
    expect(store().api!.getCalls('./dependency', 'foo')).toEqual([[10]])
  })

  it('applies returnValue / once-queue ordering', () => {
    const m = registerDependency()
    send(
      './dependency',
      'foo',
      { op: 'set', impl: { type: 'returnValue', value: 'default' } },
      { op: 'push-once', impl: { type: 'returnValue', value: 'first' } },
    )
    expect(m.call('foo', undefined, [], undefined)).toBe('first')
    expect(m.call('foo', undefined, [], undefined)).toBe('default')
  })

  it('falls back to the original after once-queue drains with no default', () => {
    const m = registerDependency()
    send('./dependency', 'foo', { op: 'push-once', impl: { type: 'returnValue', value: 'once' } })
    expect(m.call('foo', undefined, [10], undefined)).toBe('once')
    expect(m.call('foo', undefined, [10], undefined)).toBe(20)
  })

  it('supports resolved and rejected values', async () => {
    const m = registerDependency({ foo: async () => 'real' })
    send('./dependency', 'foo', {
      op: 'set',
      impl: { type: 'resolvedValue', value: { name: 'Alice' } },
    })
    await expect(m.call('foo', undefined, [], undefined)).resolves.toEqual({ name: 'Alice' })

    send('./dependency', 'foo', {
      op: 'set',
      impl: { type: 'rejectedValue', error: { name: 'ApiError', message: 'boom' } },
    })
    await expect(m.call('foo', undefined, [], undefined)).rejects.toMatchObject({
      name: 'ApiError',
      message: 'boom',
    })
  })

  it('evaluates implementation sources', () => {
    const m = registerDependency()
    send('./dependency', 'foo', {
      op: 'set',
      impl: { type: 'implementation', fnSource: '(v) => v + 1' },
    })
    expect(m.call('foo', undefined, [10], undefined)).toBe(11)
  })

  it('restore stops mocking and recording; a later set re-enables', () => {
    const m = registerDependency()
    send('./dependency', 'foo', { op: 'set', impl: { type: 'returnValue', value: 999 } })
    expect(m.call('foo', undefined, [10], undefined)).toBe(999)

    send('./dependency', 'foo', { op: 'restore' })
    expect(m.call('foo', undefined, [10], undefined)).toBe(20)
    expect(store().api!.getCalls('./dependency', 'foo')).toEqual([[10]])

    send('./dependency', 'foo', { op: 'set', impl: { type: 'returnValue', value: 1 } })
    expect(m.call('foo', undefined, [10], undefined)).toBe(1)
  })

  it('reset clears state but keeps spying', () => {
    const m = registerDependency()
    send('./dependency', 'foo', { op: 'set', impl: { type: 'returnValue', value: 999 } })
    m.call('foo', undefined, [1], undefined)
    send('./dependency', 'foo', { op: 'reset' })
    expect(m.call('foo', undefined, [10], undefined)).toBe(20)
    expect(store().api!.getCalls('./dependency', 'foo')).toEqual([[10]])
  })
})

describe('pending attachment and validation', () => {
  it('attaches mocks registered before the module loads', () => {
    send('./dependency', 'foo', { op: 'set', impl: { type: 'returnValue', value: 999 } })
    const m = registerDependency()
    expect(m.call('foo', undefined, [10], undefined)).toBe(999)
  })

  it('merges handles that address the same export via different specifiers', () => {
    const m = registerDependency()
    send('./dependency', 'foo', { op: 'set', impl: { type: 'returnValue', value: 1 } })
    send('src/demo/dependency', 'foo', { op: 'set', impl: { type: 'returnValue', value: 2 } })
    expect(m.call('foo', undefined, [], undefined)).toBe(2)
    // Both handles read the shared call log.
    expect(store().api!.getCalls('./dependency', 'foo')).toEqual([[]])
    expect(store().api!.getCalls('src/demo/dependency', 'foo')).toEqual([[]])
  })

  it('rejects unknown exports with the available list', () => {
    registerDependency()
    expect(() => send('./dependency', 'fooo')).toThrow(/no mockable export "fooo".*foo/s)
  })

  it('rejects ambiguous specifiers listing all candidates', () => {
    registerDependency()
    __pw_module__(
      { id: 'src/other/dependency.ts', specifiers: [], exportNames: ['foo'] },
      { foo: () => 0 },
    )
    expect(() => send('dependency', 'foo')).toThrow(/ambiguous.*src\/demo\/dependency\.ts.*src\/other\/dependency\.ts/s)
  })

  it('detects ambiguity that only appears after a later module loads', () => {
    registerDependency()
    send('dependency', 'foo') // attaches: only one candidate so far
    __pw_module__(
      { id: 'src/other/dependency.ts', specifiers: [], exportNames: ['foo'] },
      { foo: () => 0 },
    )
    expect(store().errors.join('\n')).toMatch(/ambiguous/)
    expect(() => store().api!.apply()).toThrow(/ambiguous/)
  })

  it('defers validation errors raised during module evaluation', () => {
    send('./dependency', 'nope')
    registerDependency() // must not throw during module evaluation
    expect(store().errors.length).toBe(1)
    expect(() => store().api!.apply()).toThrow(/no mockable export "nope"/)
  })

  it('reports never-attached mocks at reset', () => {
    registerDependency()
    send('./missing', 'foo')
    const report = store().api!.reset()
    expect(report.pending).toEqual(['mock("./missing", "foo")'])
  })

  it('getCalls on a pending mock throws with loaded module list', () => {
    registerDependency()
    send('./missing', 'foo')
    expect(() => store().api!.getCalls('./missing', 'foo')).toThrow(
      /never attached.*src\/demo\/dependency\.ts/s,
    )
  })

  it('module registrations survive reset (page reuse)', () => {
    const m = registerDependency()
    store().api!.reset()
    send('./dependency', 'foo', { op: 'set', impl: { type: 'returnValue', value: 7 } })
    expect(m.call('foo', undefined, [], undefined)).toBe(7)
  })
})

describe('wrap()', () => {
  it('wraps functions with a stable, name-preserving wrapper', () => {
    const m = registerDependency()
    const wrapped = m.wrap('foo') as Function
    expect(typeof wrapped).toBe('function')
    expect(wrapped.name).toBe('foo')
    expect(m.wrap('foo')).not.toBe(m.wrap('foo')) // wrap() is called once per proxy line
    expect((wrapped as (v: number) => number)(10)).toBe(20)
  })

  it('passes classes and values through untouched', () => {
    class Greeter {}
    const meta = { id: 'src/x.ts', specifiers: [], exportNames: ['Greeter', 'config'] }
    const m = __pw_module__(meta, { Greeter, config: { a: 1 } })
    expect(m.wrap('Greeter')).toBe(Greeter)
    expect(m.wrap('config')).toEqual({ a: 1 })
  })

  it('supports constructing wrapped constructor functions', () => {
    function Point(this: { x: number }, x: number) {
      this.x = x
    }
    const meta = { id: 'src/point.ts', specifiers: ['./point'], exportNames: ['Point'] }
    const m = __pw_module__(meta, { Point })
    const Wrapped = m.wrap('Point') as new (x: number) => { x: number }
    const p = new Wrapped(5)
    expect(p.x).toBe(5)
    expect(p).toBeInstanceOf(Point)
  })

  it('proxies default-exported plain objects with mockable methods', () => {
    const client = {
      base: 'https://real',
      get(this: { base: string }, path: string) {
        return `${this.base}${path}`
      },
    }
    const meta = { id: 'src/client.ts', specifiers: ['./client'], exportNames: ['default'] }
    const m = __pw_module__(meta, { default: client })
    const proxied = m.wrap('default') as typeof client

    // `this` flows through the proxy.
    expect(proxied.get('/users')).toBe('https://real/users')
    expect(proxied.base).toBe('https://real')

    send('./client', 'default.get', { op: 'set', impl: { type: 'returnValue', value: 'mocked' } })
    expect(proxied.get('/users')).toBe('mocked')
    expect(store().api!.getCalls('./client', 'default.get')).toEqual([['/users']])
  })

  it('supports mocking via hoisted call() dispatch with new.target', () => {
    function Thing(this: { tag: string }) {
      this.tag = 'real'
    }
    const meta = { id: 'src/thing.ts', specifiers: ['./thing'], exportNames: ['Thing'] }
    const m = __pw_module__(meta, { Thing })
    class AsTarget {}
    const built = m.call('Thing', undefined, [], AsTarget) as { tag: string }
    expect(built.tag).toBe('real')
  })
})

describe('sanitizeValue', () => {
  it('snapshots arguments at call time', () => {
    const m = registerDependency()
    send('./dependency', 'foo')
    const arg = { count: 1 }
    m.call('foo', undefined, [arg], undefined)
    arg.count = 99
    expect(store().api!.getCalls('./dependency', 'foo')).toEqual([[{ count: 1 }]])
  })

  it('handles special values', () => {
    expect(sanitizeValue(new Date('2026-01-01'))).toEqual(new Date('2026-01-01'))
    expect(sanitizeValue(() => {})).toBe('[Function]')
    expect(sanitizeValue(function named() {})).toBe('[Function: named]')
    expect(sanitizeValue(new Error('x'))).toEqual({ name: 'Error', message: 'x' })
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(sanitizeValue(circular)).toEqual({ self: '[Circular]' })
    expect(sanitizeValue(new Map([['a', 1]]))).toBe('[Map(1)]')
  })
})
