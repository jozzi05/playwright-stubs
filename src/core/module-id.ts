/**
 * Module identity resolution.
 *
 * `mock('./api', ...)` must find the registered module it refers to. Each
 * registered module carries its canonical id (root-relative resolved path),
 * the raw specifiers observed at build time, and — for node_modules — the
 * bare package name. Matching rules, in order of strength:
 *
 *  1. exact match on canonical id or an observed raw specifier;
 *  2. exact match on the derived package name (`mock('@company/api')`);
 *  3. extension-insensitive, `/index`-insensitive suffix match on the
 *     canonical id (`mock('./api')` matches `src/demo/api.ts` and
 *     `src/demo/api/index.ts`).
 *
 * Zero matches leaves the mock pending (the module may not have loaded yet);
 * more than one distinct match is an explicit ambiguity error.
 */

import type { ModuleRegistration } from './protocol'

const QUERY_RE = /[?#].*$/
const EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/

export function normalizeModuleId(id: string): string {
  let normalized = id.replace(QUERY_RE, '').replace(EXT_RE, '')
  if (normalized.endsWith('/index')) normalized = normalized.slice(0, -'/index'.length)
  return normalized
}

/** Strip leading `./` and `../` segments so relative specs suffix-match. */
export function normalizeSpecifier(spec: string): string {
  return normalizeModuleId(spec).replace(/^(\.\.?\/)+/, '')
}

export function derivePackageName(id: string): string | undefined {
  const match = id.match(/node_modules\/((?:@[^/]+\/)?[^/?]+)(?!.*node_modules)/)
  return match ? match[1] : undefined
}

export function findModules(
  spec: string,
  modules: Iterable<ModuleRegistration>,
): ModuleRegistration[] {
  const wanted = normalizeSpecifier(spec)
  const found: ModuleRegistration[] = []

  for (const module of modules) {
    const matches =
      module.id === spec ||
      module.specifiers.includes(spec) ||
      module.packageName === spec ||
      (wanted !== '' &&
        (normalizeModuleId(module.id) === wanted ||
          normalizeModuleId(module.id).endsWith('/' + wanted)))
    if (matches) found.push(module)
  }

  return found
}
