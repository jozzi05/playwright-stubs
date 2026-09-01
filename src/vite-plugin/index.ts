/**
 * Vite plugin wiring for the import-site transform.
 *
 * - No package allowlist (brief Goal B). Instead, the plugin instruments
 *   application/source modules and skips anything that resolves into
 *   node_modules -- the import statement itself tells us what to wrap.
 * - Runs with `enforce: 'post'` so it sees plain ESM after esbuild/React
 *   transforms but before Vite's internal import analysis.
 * - Serves the browser runtime as a real file behind a virtual specifier so
 *   Vite applies its normal TS pipeline to it.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { RUNTIME_SPECIFIER, transformImports } from './transform'

const RUNTIME_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../core/runtime.ts',
)
const CORE_DIR = path.dirname(RUNTIME_PATH)

const TRANSFORMABLE_RE = /\.(ts|tsx|js|jsx|mjs)($|\?)/
const TEST_FILE_RE = /\.(spec|test)\.[cm]?[jt]sx?($|\?)/

export type PlaywrightStubsOptions = {
  /** Log every transformed module and skipped binding. */
  debug?: boolean
}

export function playwrightStubs(options: PlaywrightStubsOptions = {}): Plugin {
  let root = process.cwd()

  return {
    name: 'playwright-stubs',
    enforce: 'post',

    configResolved(config) {
      root = config.root
    },

    resolveId(id) {
      if (id === RUNTIME_SPECIFIER) return RUNTIME_PATH
      return null
    },

    async transform(code, id) {
      if (id.startsWith('\0')) return null
      if (id.includes('/node_modules/')) return null
      if (!TRANSFORMABLE_RE.test(id)) return null
      // Never instrument the runtime itself or test files (Playwright CT
      // compiles spec imports specially; wrapping them would break mounting).
      if (id.startsWith(CORE_DIR)) return null
      if (TEST_FILE_RE.test(id)) return null

      const resolveModuleId = async (specifier: string, importer: string) => {
        const resolved = await this.resolve(specifier, importer)
        if (!resolved || resolved.external) return null
        if (resolved.id.startsWith('\0')) return null
        // v1: local/source modules only. Dependencies (including Vite
        // pre-bundled ones) are left untouched.
        if (resolved.id.includes('/node_modules/')) return null
        const clean = resolved.id.replace(/[?#].*$/, '')
        const relative = path.relative(root, clean)
        return relative.startsWith('..') ? clean : relative
      }

      const result = await transformImports(code, id, resolveModuleId)
      if (!result) return null

      if (options.debug) {
        console.log(`[playwright-stubs] transformed ${path.relative(root, id)}`)
        for (const item of result.instrumented) {
          console.log(`[playwright-stubs]   ${item.specifier}#${item.exportName}`)
        }
        for (const item of result.skipped) {
          console.log(`[playwright-stubs]   skipped ${item.local}: ${item.reason}`)
        }
      }

      return { code: result.code, map: result.map }
    },
  }
}
