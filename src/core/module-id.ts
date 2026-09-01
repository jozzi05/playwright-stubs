/**
 * Module identity matching, shared between the browser runtime and tests.
 *
 * The registry must answer: does the specifier the test passed to
 * `mock('./dependency', 'foo')` refer to the module behind a given import
 * site? Import sites carry both the raw specifier written in the consumer and
 * the Vite-resolved module id (relative to the project root, query stripped).
 *
 * Matching rules, in order:
 *  1. Exact match on the raw specifier (covers bare package names and tests
 *     that use the same relative path as the consumer).
 *  2. Extension-insensitive suffix match against the resolved module id, so
 *     `mock('./dependency', ...)` matches `src/demo/dependency.ts` and
 *     `mock('src/demo/dependency', ...)` does too.
 */

const QUERY_RE = /[?#].*$/
const EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/

export function normalizeModuleId(id: string): string {
  return id.replace(QUERY_RE, '').replace(EXT_RE, '')
}

export function moduleMatches(
  mockSpecifier: string,
  site: { specifier: string; moduleId: string },
): boolean {
  if (mockSpecifier === site.specifier) return true

  const wanted = normalizeModuleId(mockSpecifier).replace(/^\.\//, '')
  if (wanted === '') return false
  const resolved = normalizeModuleId(site.moduleId)

  return resolved === wanted || resolved.endsWith('/' + wanted)
}
