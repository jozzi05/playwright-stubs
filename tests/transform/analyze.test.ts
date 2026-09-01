/**
 * Export classification tests. Inputs are plain ESM, matching what the
 * plugin sees after esbuild strips TypeScript/JSX.
 */

import { describe, expect, it } from 'vitest'
import { analyzeModuleSource } from '../../src/vite-plugin/analyze'

describe('analyzeModuleSource', () => {
  it('classifies function declarations as hoistable functions', () => {
    const analysis = analyzeModuleSource(`
      export function foo() {}
      export async function bar() {}
      export function* gen() {}
    `)
    expect(analysis.exports).toEqual([
      { name: 'foo', kind: 'function' },
      { name: 'bar', kind: 'function' },
      { name: 'gen', kind: 'function' },
    ])
  })

  it('classifies const arrow/function initializers as functions', () => {
    const analysis = analyzeModuleSource(`
      export const a = () => 1
      export const b = function () {}
      export const c = someFactory()
    `)
    expect(analysis.exports).toEqual([
      { name: 'a', kind: 'function' },
      { name: 'b', kind: 'function' },
      { name: 'c', kind: 'wrap' },
    ])
  })

  it('skips mutable bindings and classes (live/constructable passthrough)', () => {
    const analysis = analyzeModuleSource(`
      export let counter = 0
      export var legacy = 1
      export class Greeter {}
    `)
    expect(analysis.exports).toEqual([
      { name: 'counter', kind: 'skip' },
      { name: 'legacy', kind: 'skip' },
      { name: 'Greeter', kind: 'skip' },
    ])
  })

  it('resolves export-specifier kinds from local declarations', () => {
    const analysis = analyzeModuleSource(`
      function foo() {}
      const bar = () => 1
      let mut = 2
      const value = {}
      export { foo, bar as renamed, mut, value }
    `)
    expect(analysis.exports).toEqual([
      { name: 'foo', kind: 'function' },
      { name: 'renamed', kind: 'function' },
      { name: 'mut', kind: 'skip' },
      { name: 'value', kind: 'wrap' },
    ])
  })

  it('treats re-exports and imported bindings as runtime-decided', () => {
    const analysis = analyzeModuleSource(`
      import { helper } from './helper'
      export { helper }
      export { getUser, deleteUser as removeUser } from './users'
    `)
    expect(analysis.exports).toEqual([
      { name: 'helper', kind: 'wrap' },
      { name: 'getUser', kind: 'wrap' },
      { name: 'removeUser', kind: 'wrap' },
    ])
  })

  it('classifies defaults', () => {
    expect(analyzeModuleSource(`export default function foo() {}`).defaultKind).toBe('function')
    expect(analyzeModuleSource(`export default () => 1`).defaultKind).toBe('function')
    expect(analyzeModuleSource(`export default class Foo {}`).defaultKind).toBe('class')
    expect(analyzeModuleSource(`export default { a: 1 }`).defaultKind).toBe('wrap')
    expect(analyzeModuleSource(`const x = 1\nexport default x`).defaultKind).toBe('wrap')
    expect(
      analyzeModuleSource(`function f() {}\nexport default f`).defaultKind,
    ).toBe('function')
    expect(analyzeModuleSource(`function f() {}\nexport { f as default }`).defaultKind).toBe(
      'function',
    )
    expect(analyzeModuleSource(`export { default } from './other'`).defaultKind).toBe('wrap')
    expect(analyzeModuleSource(`export const x = 1`).defaultKind).toBe('none')
  })

  it('collects export * sources and namespace re-exports', () => {
    const analysis = analyzeModuleSource(`
      export * from './users'
      export * from './posts'
      export * as helpers from './helpers'
    `)
    expect(analysis.starSources).toEqual(['./users', './posts'])
    expect(analysis.exports).toEqual([{ name: 'helpers', kind: 'wrap' }])
  })

  it('detects CommonJS', () => {
    expect(analyzeModuleSource(`module.exports = function () {}`).cjs).toBe(true)
    expect(analyzeModuleSource(`exports.foo = 1`).cjs).toBe(true)
    expect(analyzeModuleSource(`export const foo = 1`).cjs).toBe(false)
    // ESM syntax wins even if the file mentions module.exports in a string.
    expect(analyzeModuleSource(`export const s = "module.exports"`).cjs).toBe(false)
  })
})
