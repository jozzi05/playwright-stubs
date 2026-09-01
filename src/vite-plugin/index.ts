/**
 * Vite plugin: universal module proxying.
 *
 * Every import of an in-scope module -- static, dynamic, or re-export, from
 * application source or node_modules -- is redirected in `resolveId` to a
 * generated proxy module (`\0pw-proxy:<real id>`). The proxy imports the real
 * module, registers it with the browser runtime, and re-exports its exports
 * behind stable wrappers. Consumers and real modules are never transformed:
 * source maps, evaluation order and side effects are untouched, and all
 * consumers share one wrapper per export (preserving function identity).
 *
 * No package allowlist: the resolved location decides scope, with a small
 * default exclude list (React itself, tooling) that can be extended.
 */

import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform as esbuildTransform } from 'esbuild'
import type { Plugin } from 'vite'
import type { ModuleRegistration } from '../core/protocol.js'
import { derivePackageName } from '../core/module-id.js'
import { analyzeModuleSource, type ModuleAnalysis } from './analyze.js'
import { generateProxyModule, isEmittableName } from './codegen.js'

export const RUNTIME_SPECIFIER = 'virtual:playwright-stubs/runtime'
const PROXY_PREFIX = '\0pw-proxy:'

const RUNTIME_BASE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../core/runtime',
)
const RUNTIME_PATH = existsSync(`${RUNTIME_BASE}.js`)
  ? `${RUNTIME_BASE}.js`
  : `${RUNTIME_BASE}.ts`
const CORE_DIR = path.dirname(RUNTIME_PATH)

const JS_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/

const DEFAULT_EXCLUDE: RegExp[] = [
  // React must keep its singletons untouched; wrapping its exports buys
  // nothing and risks a lot.
  /node_modules\/(react|react-dom|react-refresh|scheduler)\//,
  // Tooling and test infrastructure.
  /node_modules\/(@vitejs|vite|@playwright|playwright|playwright-core)\//,
  /node_modules\/\.vite\//,
  // The Playwright CT bootstrap.
  /\/playwright\/index\.[tj]sx?$/,
]

const ESBUILD_LOADERS: Record<string, 'ts' | 'tsx' | 'jsx'> = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.js': 'jsx',
  '.mjs': 'jsx',
  '.cjs': 'jsx',
  '.jsx': 'jsx',
}

export type PlaywrightStubsOptions = {
  /** Log proxied modules and their mockable exports. */
  debug?: boolean
  /** Additional patterns (tested against resolved ids) to leave untouched. */
  exclude?: RegExp[]
  /** Proxy modules inside node_modules (default true). */
  includeNodeModules?: boolean
}

type DiscoveredExports = {
  functionExports: string[]
  wrapExports: string[]
  defaultKind: 'none' | 'function' | 'class' | 'wrap'
}

export function playwrightStubs(options: PlaywrightStubsOptions = {}): Plugin {
  const excludePatterns = [...DEFAULT_EXCLUDE, ...(options.exclude ?? [])]
  const includeNodeModules = options.includeNodeModules ?? true

  let root = process.cwd()
  const specifierMap = new Map<string, Set<string>>()
  const analysisCache = new Map<string, Promise<ModuleAnalysis>>()

  const log = (message: string) => {
    if (options.debug) console.log(`[playwright-stubs] ${message}`)
  }

  function shouldProxy(resolvedId: string): boolean {
    if (resolvedId.startsWith('\0') || resolvedId.includes('virtual:')) return false
    if (resolvedId.includes('?') || resolvedId.includes('#')) return false
    if (!JS_EXT_RE.test(resolvedId)) return false
    if (resolvedId.startsWith(CORE_DIR + path.sep)) return false
    if (!includeNodeModules && resolvedId.includes('/node_modules/')) return false
    return !excludePatterns.some((pattern) => pattern.test(resolvedId))
  }

  async function readAndAnalyze(realId: string): Promise<ModuleAnalysis> {
    let cached = analysisCache.get(realId)
    if (!cached) {
      cached = (async () => {
        const source = await fs.readFile(realId, 'utf8')
        const loader = ESBUILD_LOADERS[path.extname(realId)] ?? 'jsx'
        const { code } = await esbuildTransform(source, { loader, format: 'esm' })
        return analyzeModuleSource(code)
      })()
      analysisCache.set(realId, cached)
    }
    return cached
  }

  return {
    name: 'playwright-stubs',
    enforce: 'pre',

    configResolved(config) {
      root = config.root
    },

    async resolveId(source, importer) {
      if (source === RUNTIME_SPECIFIER) return RUNTIME_PATH
      if (source.startsWith(PROXY_PREFIX)) return source

      // Imports issued by a generated proxy reference the real module by its
      // resolved id; pass them through untouched.
      if (importer?.startsWith(PROXY_PREFIX)) return source

      if (!importer) return null
      if (source.startsWith('\0') || source.startsWith('virtual:')) return null
      if (source.includes('?')) return null

      const resolved = await this.resolve(source, importer, { skipSelf: true })
      if (!resolved || resolved.external) return null
      if (!shouldProxy(resolved.id)) return null

      let specs = specifierMap.get(resolved.id)
      if (!specs) {
        specs = new Set()
        specifierMap.set(resolved.id, specs)
      }
      specs.add(source)

      return PROXY_PREFIX + resolved.id
    },

    async load(id) {
      if (!id.startsWith(PROXY_PREFIX)) return null
      const realId = id.slice(PROXY_PREFIX.length)

      const discovered = await discoverExports(realId, this)

      const relative = path.relative(root, realId)
      const canonicalId = relative.startsWith('..') ? realId : relative

      const registration: ModuleRegistration = {
        id: canonicalId,
        specifiers: [...(specifierMap.get(realId) ?? [])].sort(),
        packageName: derivePackageName(realId),
        exportNames: [
          ...discovered.functionExports,
          ...discovered.wrapExports,
          ...(discovered.defaultKind !== 'none' && discovered.defaultKind !== 'class'
            ? ['default']
            : []),
        ],
      }

      log(
        `proxy ${canonicalId} exports=[${registration.exportNames.join(', ')}] ` +
          `default=${discovered.defaultKind}`,
      )

      return generateProxyModule({
        runtimeSpecifier: RUNTIME_SPECIFIER,
        realSpecifier: realId,
        registration,
        functionExports: discovered.functionExports,
        wrapExports: discovered.wrapExports,
        defaultKind: discovered.defaultKind,
      })
    },
  }

  /**
   * Classify the module's exports, chasing `export * from` chains (bounded)
   * so facade modules remain mockable under their own id.
   */
  async function discoverExports(
    realId: string,
    ctx: { resolve: Plugin extends never ? never : any; warn?: (msg: string) => void },
  ): Promise<DiscoveredExports> {
    const functionExports: string[] = []
    const wrapExports: string[] = []
    const seen = new Set<string>()
    let defaultKind: DiscoveredExports['defaultKind'] = 'none'

    const addName = (name: string, kind: 'function' | 'wrap') => {
      if (seen.has(name) || !isEmittableName(name)) return
      seen.add(name)
      if (kind === 'function') functionExports.push(name)
      else wrapExports.push(name)
    }

    const visited = new Set<string>([realId])

    const visit = async (moduleId: string, isRoot: boolean, depth: number): Promise<void> => {
      let analysis: ModuleAnalysis
      try {
        analysis = await readAndAnalyze(moduleId)
      } catch (error) {
        log(`discovery failed for ${moduleId}: ${(error as Error).message}`)
        return
      }

      if (analysis.cjs && isRoot) {
        // Named CJS exports are synthesized by the bundler and flow through
        // `export *`; only the default (module.exports) is wrapped/mockable.
        defaultKind = 'wrap'
        return
      }

      for (const entry of analysis.exports) {
        if (entry.kind === 'skip') continue
        // Names from chased re-exports are always runtime-decided: the origin
        // module's own proxy provides the statically-known wrapping.
        addName(entry.name, isRoot ? entry.kind : 'wrap')
      }
      if (isRoot) defaultKind = analysis.defaultKind

      if (depth >= 8) return
      for (const starSource of analysis.starSources) {
        try {
          const resolved = await ctx.resolve(starSource, moduleId, { skipSelf: true })
          if (!resolved || resolved.external) continue
          const target = resolved.id.replace(/[?#].*$/, '')
          if (!JS_EXT_RE.test(target) || visited.has(target)) continue
          visited.add(target)
          await visit(target, false, depth + 1)
        } catch {
          // Unresolvable star source: names stay reachable via passthrough.
        }
      }
    }

    await visit(realId, true, 0)
    return { functionExports, wrapExports, defaultKind }
  }
}
