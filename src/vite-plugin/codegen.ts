/**
 * Proxy module generation.
 *
 * The proxy is the only code this project generates; consumers and real
 * modules are never rewritten (source maps stay pristine). Layout:
 *
 *   import { __pw_module__ } from "virtual:playwright-stubs/runtime";
 *   import * as __pw$real from "<real>";
 *   export * from "<real>";                 // passthrough safety net
 *   var __pw$m = __pw_module__({...}, __pw$real);
 *   export function getUser(...) { ... }    // hoisted, circular-safe
 *   export const helper = __pw$m.wrap("helper");
 *   const __pw$default = __pw$m.wrap("default");
 *   export default __pw$default;
 *
 * Notes on correctness:
 *  - Explicit exports take precedence over `export *` names (ESM rule), so
 *    wrapped names shadow the passthrough while unknown/skipped names still
 *    flow through with live bindings.
 *  - Hoisted wrapper functions guard on `__pw$m` (a `var`, so it is
 *    `undefined` rather than TDZ before the proxy body runs) and fall back to
 *    the real namespace binding, which exists from instantiation time. This
 *    keeps evaluation-time calls in circular graphs working.
 */

import type { ModuleRegistration } from '../core/protocol.js'

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

// Words that cannot appear as `export function NAME` / `export const NAME`.
const RESERVED = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
  'finally', 'for', 'function', 'if', 'implements', 'import', 'in',
  'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private',
  'protected', 'public', 'return', 'static', 'super', 'switch', 'this',
  'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
])

const INTERNALS = new Set(['__pw$real', '__pw$m', '__pw$default'])

export function isEmittableName(name: string): boolean {
  return IDENTIFIER_RE.test(name) && !RESERVED.has(name) && !INTERNALS.has(name)
}

export type ProxyCodegenInput = {
  runtimeSpecifier: string
  /** Import path for the real module (its resolved id). */
  realSpecifier: string
  registration: ModuleRegistration
  /** Statically known function exports: emitted as hoisted declarations. */
  functionExports: string[]
  /** Unknown-kind exports: emitted as runtime-decided consts. */
  wrapExports: string[]
  defaultKind: 'none' | 'function' | 'class' | 'wrap'
}

export function generateProxyModule(input: ProxyCodegenInput): string {
  const real = JSON.stringify(input.realSpecifier)
  const lines: string[] = [
    `import { __pw_module__ } from ${JSON.stringify(input.runtimeSpecifier)};`,
    `import * as __pw$real from ${real};`,
    `export * from ${real};`,
    `var __pw$m = __pw_module__(${JSON.stringify(input.registration)}, __pw$real);`,
  ]

  for (const name of input.functionExports) {
    const key = JSON.stringify(name)
    lines.push(
      `export function ${name}(...__pw$args) {`,
      `  if (__pw$m !== undefined) return __pw$m.call(${key}, this, __pw$args, new.target);`,
      `  return new.target !== undefined`,
      `    ? Reflect.construct(__pw$real[${key}], __pw$args, new.target)`,
      `    : Reflect.apply(__pw$real[${key}], this, __pw$args);`,
      `}`,
    )
  }

  for (const name of input.wrapExports) {
    lines.push(`export const ${name} = __pw$m.wrap(${JSON.stringify(name)});`)
  }

  if (input.defaultKind === 'class') {
    lines.push(`const __pw$default = __pw$m.raw("default");`, `export default __pw$default;`)
  } else if (input.defaultKind !== 'none') {
    lines.push(`const __pw$default = __pw$m.wrap("default");`, `export default __pw$default;`)
  }

  return lines.join('\n') + '\n'
}
