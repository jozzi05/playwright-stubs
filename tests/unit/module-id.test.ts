import { describe, expect, it } from 'vitest'
import { derivePackageName, findModules, normalizeSpecifier } from '../../src/core/module-id'
import type { ModuleRegistration } from '../../src/core/protocol'

function reg(id: string, extra: Partial<ModuleRegistration> = {}): ModuleRegistration {
  return { id, specifiers: [], exportNames: [], ...extra }
}

describe('normalizeSpecifier', () => {
  it('strips relative prefixes, extensions and /index', () => {
    expect(normalizeSpecifier('./api')).toBe('api')
    expect(normalizeSpecifier('../../lib/api.ts')).toBe('lib/api')
    expect(normalizeSpecifier('./api/index.ts')).toBe('api')
  })
})

describe('derivePackageName', () => {
  it('extracts scoped and unscoped package names', () => {
    expect(derivePackageName('/x/node_modules/clsx/dist/clsx.mjs')).toBe('clsx')
    expect(derivePackageName('/x/node_modules/@company/api/dist/index.js')).toBe('@company/api')
    expect(derivePackageName('/x/src/demo/api.ts')).toBeUndefined()
  })

  it('uses the innermost node_modules for nested installs', () => {
    expect(derivePackageName('/x/node_modules/a/node_modules/b/index.js')).toBe('b')
  })
})

describe('findModules', () => {
  const modules = [
    reg('src/demo/api.ts', { specifiers: ['./api'] }),
    reg('src/demo/nested/api.ts'),
    reg('src/other/index.ts'),
    reg('node_modules/clsx/dist/clsx.mjs', { packageName: 'clsx', specifiers: ['clsx'] }),
  ]

  it('matches raw specifiers exactly', () => {
    const found = findModules('./api', [modules[0]])
    expect(found.map((m) => m.id)).toEqual(['src/demo/api.ts'])
  })

  it('reports all suffix matches so ambiguity can be detected', () => {
    const found = findModules('./api', modules)
    expect(found.map((m) => m.id)).toEqual(['src/demo/api.ts', 'src/demo/nested/api.ts'])
  })

  it('disambiguates via a longer path', () => {
    const found = findModules('nested/api', modules)
    expect(found.map((m) => m.id)).toEqual(['src/demo/nested/api.ts'])
  })

  it('matches index modules by their directory name', () => {
    const found = findModules('./other', modules)
    expect(found.map((m) => m.id)).toEqual(['src/other/index.ts'])
  })

  it('matches bare package names', () => {
    const found = findModules('clsx', modules)
    expect(found.map((m) => m.id)).toEqual(['node_modules/clsx/dist/clsx.mjs'])
  })

  it('returns nothing for unknown specifiers', () => {
    expect(findModules('./nope', modules)).toEqual([])
  })
})
