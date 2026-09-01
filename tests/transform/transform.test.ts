/**
 * Golden tests for the import-site transformation (brief §91).
 * Inputs are plain ESM, matching what the plugin sees post-esbuild.
 */

import { describe, expect, it } from 'vitest'
import { transformImports, type ResolveModuleId } from '../../src/vite-plugin/transform'

// Local relative specifiers resolve inside the project; bare specifiers
// simulate node_modules (the plugin's resolver returns null for those).
const resolve: ResolveModuleId = (specifier) => {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return `src/demo/${specifier.replace(/^(\.\.?\/)+/, '')}.ts`
  }
  return null
}

async function run(code: string) {
  return transformImports(code, 'src/demo/consumer.ts', resolve)
}

describe('transformImports', () => {
  it('wraps a named import', async () => {
    const result = await run(`import { foo } from './dependency'\nconsole.log(foo(1))\n`)
    await expect(result!.code).toMatchFileSnapshot('./__snapshots__/named-import.js')
  })

  it('wraps an aliased named import, keyed by the exported name', async () => {
    const result = await run(`import { foo as bar } from './dependency'\nbar()\n`)
    await expect(result!.code).toMatchFileSnapshot('./__snapshots__/aliased-import.js')
    expect(result!.instrumented).toEqual([
      { specifier: './dependency', exportName: 'foo', local: 'bar' },
    ])
  })

  it('wraps multiple specifiers and multiple statements', async () => {
    const result = await run(
      `import { foo, bar } from './a'\nimport { baz } from './b'\nfoo(); bar(); baz()\n`,
    )
    await expect(result!.code).toMatchFileSnapshot('./__snapshots__/multiple-imports.js')
  })

  it('leaves the default binding of a mixed import untouched', async () => {
    const result = await run(`import def, { foo } from './dependency'\ndef(); foo()\n`)
    await expect(result!.code).toMatchFileSnapshot('./__snapshots__/mixed-import.js')
    expect(result!.instrumented).toHaveLength(1)
  })

  it('does not touch default-only imports', async () => {
    expect(await run(`import def from './dependency'\ndef()\n`)).toBeNull()
  })

  it('does not touch namespace imports', async () => {
    expect(await run(`import * as api from './dependency'\napi.foo()\n`)).toBeNull()
  })

  it('does not touch side-effect imports', async () => {
    expect(await run(`import './register'\n`)).toBeNull()
  })

  it('does not touch re-export statements', async () => {
    expect(await run(`export { foo } from './dependency'\n`)).toBeNull()
    expect(await run(`export * from './dependency'\n`)).toBeNull()
  })

  it('does not touch dynamic imports', async () => {
    expect(await run(`const mod = await import('./dependency')\n`)).toBeNull()
  })

  it('skips bindings that resolve into node_modules', async () => {
    expect(await run(`import { useState } from 'react'\nuseState()\n`)).toBeNull()
  })

  it('skips bindings that the consumer re-exports (brief §40)', async () => {
    const result = await run(
      `import { foo, bar } from './dependency'\nexport { foo }\nbar()\n`,
    )
    await expect(result!.code).toMatchFileSnapshot('./__snapshots__/reexported-binding.js')
    expect(result!.instrumented).toEqual([
      { specifier: './dependency', exportName: 'bar', local: 'bar' },
    ])
    expect(result!.skipped).toEqual([{ local: 'foo', reason: 'binding-is-reexported' }])
  })

  it('skips `import { default as x }`', async () => {
    expect(await run(`import { default as x } from './dependency'\nx()\n`)).toBeNull()
  })

  it('returns null when nothing was instrumented', async () => {
    expect(await run(`const x = 1\n`)).toBeNull()
    expect(await run(``)).toBeNull()
  })

  it('produces a source map', async () => {
    const result = await run(`import { foo } from './dependency'\nfoo()\n`)
    expect(result!.map).toBeTruthy()
    expect(result!.map.mappings.length).toBeGreaterThan(0)
  })
})
