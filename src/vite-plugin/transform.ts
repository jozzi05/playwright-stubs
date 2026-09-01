/**
 * The import-site transformation (brief §12, §39). Deliberately minimal:
 *
 *   import { foo } from './dep'
 *
 * becomes
 *
 *   import { __pw_import__ } from 'virtual:playwright-stubs/runtime'
 *   import { foo as __pw_0_foo } from './dep'
 *   const foo = __pw_import__({ specifier: './dep', moduleId: 'src/dep.ts' }, 'foo', __pw_0_foo)
 *
 * Only named import specifiers are touched. Default imports, namespace
 * imports, side-effect imports, re-exports, `export *` and dynamic imports
 * pass through untouched (v1 scope). Bindings that are re-exported from the
 * consumer (`import { foo } ...; export { foo }`) are skipped to preserve
 * ESM re-export semantics (brief §40).
 *
 * The transform expects plain ESM JavaScript, i.e. it runs after Vite's
 * esbuild/React transforms (`enforce: 'post'`). Parsing is done with acorn --
 * an established parser, no custom ESM parsing (brief §38).
 */

import { parse } from 'acorn'
import MagicString from 'magic-string'

export const RUNTIME_SPECIFIER = 'virtual:playwright-stubs/runtime'

export type ResolveModuleId = (
  specifier: string,
  importer: string,
) => Promise<string | null> | string | null

export type TransformResult = {
  code: string
  map: ReturnType<MagicString['generateMap']>
  instrumented: { specifier: string; exportName: string; local: string }[]
  skipped: { local: string; reason: string }[]
} | null

type AcornNode = {
  type: string
  start: number
  end: number
  [key: string]: unknown
}

function collectReexportedLocals(program: AcornNode): Set<string> {
  const exported = new Set<string>()
  for (const node of program.body as AcornNode[]) {
    if (node.type === 'ExportNamedDeclaration' && !node.source && Array.isArray(node.specifiers)) {
      for (const spec of node.specifiers as AcornNode[]) {
        const local = spec.local as AcornNode & { name?: string }
        if (local?.name) exported.add(local.name)
      }
    }
    if (node.type === 'ExportDefaultDeclaration') {
      const declaration = node.declaration as AcornNode & { name?: string }
      if (declaration?.type === 'Identifier' && declaration.name) exported.add(declaration.name)
    }
  }
  return exported
}

export async function transformImports(
  code: string,
  importer: string,
  resolveModuleId: ResolveModuleId,
): Promise<TransformResult> {
  if (!code.includes('import')) return null

  const program = parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowHashBang: true,
  }) as unknown as AcornNode

  const reexported = collectReexportedLocals(program)
  const s = new MagicString(code)
  const instrumented: { specifier: string; exportName: string; local: string }[] = []
  const skipped: { local: string; reason: string }[] = []
  let counter = 0

  for (const node of program.body as AcornNode[]) {
    if (node.type !== 'ImportDeclaration') continue

    const source = node.source as AcornNode & { value?: unknown }
    const specifier = source?.value
    if (typeof specifier !== 'string') continue
    if (specifier === RUNTIME_SPECIFIER) continue

    const specifiers = node.specifiers as AcornNode[]
    const named = specifiers.filter((spec) => spec.type === 'ImportSpecifier')
    if (named.length === 0) continue

    const moduleId = await resolveModuleId(specifier, importer)
    if (moduleId === null) continue

    const wrappers: string[] = []

    for (const spec of named) {
      const imported = spec.imported as AcornNode & { name?: string; value?: string }
      const local = spec.local as AcornNode & { name: string }
      // `import { default as x }` and string import names are out of v1 scope.
      const exportName = imported.name ?? imported.value
      if (!exportName || exportName === 'default') {
        skipped.push({ local: local.name, reason: 'default-or-string-import' })
        continue
      }
      if (reexported.has(local.name)) {
        skipped.push({ local: local.name, reason: 'binding-is-reexported' })
        continue
      }

      const hidden = `__pw_${counter++}_${local.name}`
      if (imported.start === local.start) {
        // Shorthand `{ foo }` -> `{ foo as __pw_0_foo }`
        s.overwrite(spec.start, spec.end, `${exportName} as ${hidden}`)
      } else {
        // Aliased `{ foo as bar }` -> `{ foo as __pw_0_bar }`
        s.overwrite(local.start, local.end, hidden)
      }

      const meta = JSON.stringify({ specifier, moduleId })
      wrappers.push(
        `const ${local.name} = __pw_import__(${meta}, ${JSON.stringify(exportName)}, ${hidden});`,
      )
      instrumented.push({ specifier, exportName, local: local.name })
    }

    if (wrappers.length > 0) {
      s.appendRight(node.end, `\n${wrappers.join('\n')}`)
    }
  }

  if (instrumented.length === 0) return null

  s.prepend(`import { __pw_import__ } from ${JSON.stringify(RUNTIME_SPECIFIER)};\n`)

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true, source: importer }),
    instrumented,
    skipped,
  }
}
