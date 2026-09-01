/**
 * Golden tests for proxy module generation.
 */

import { describe, expect, it } from 'vitest'
import { generateProxyModule, isEmittableName } from '../../src/vite-plugin/codegen'

const BASE = {
  runtimeSpecifier: 'virtual:playwright-stubs/runtime',
  realSpecifier: '/repo/src/demo/api.ts',
  registration: {
    id: 'src/demo/api.ts',
    specifiers: ['./api'],
    packageName: undefined,
    exportNames: ['getUser', 'helper', 'default'],
  },
}

describe('generateProxyModule', () => {
  it('generates hoisted wrappers, runtime-decided consts and a default', async () => {
    const code = generateProxyModule({
      ...BASE,
      functionExports: ['getUser'],
      wrapExports: ['helper'],
      defaultKind: 'function',
    })
    await expect(code).toMatchFileSnapshot('./__snapshots__/proxy-full.js')
  })

  it('generates a pure passthrough for modules with nothing to wrap', async () => {
    const code = generateProxyModule({
      ...BASE,
      registration: { ...BASE.registration, exportNames: [] },
      functionExports: [],
      wrapExports: [],
      defaultKind: 'none',
    })
    await expect(code).toMatchFileSnapshot('./__snapshots__/proxy-passthrough.js')
  })

  it('passes class defaults through raw', async () => {
    const code = generateProxyModule({
      ...BASE,
      registration: { ...BASE.registration, exportNames: [] },
      functionExports: [],
      wrapExports: [],
      defaultKind: 'class',
    })
    await expect(code).toMatchFileSnapshot('./__snapshots__/proxy-class-default.js')
  })
})

describe('isEmittableName', () => {
  it('accepts normal identifiers and rejects hazards', () => {
    expect(isEmittableName('getUser')).toBe(true)
    expect(isEmittableName('$internal_1')).toBe(true)
    expect(isEmittableName('new')).toBe(false)
    expect(isEmittableName('a-b')).toBe(false)
    expect(isEmittableName('__pw$real')).toBe(false)
  })
})
