/**
 * Static analysis of a module's own source to classify its exports.
 *
 * Input is plain JavaScript ESM (TypeScript/JSX stripped by esbuild before
 * this runs). Output drives proxy generation:
 *
 *  - `function`: statically known functions (declarations, arrow/function
 *    initializers). Emitted as *hoisted* wrapper function declarations so
 *    circular-dependency access before evaluation keeps working, exactly as
 *    it does for the original function declarations.
 *  - `wrap`: kind unknown at build time (re-exports, imported bindings,
 *    arbitrary const initializers). Emitted as a runtime-decided const:
 *    functions get a wrapper, anything else passes through by value.
 *  - `skip`: never wrapped (classes, mutable `let`/`var` bindings). These
 *    reach consumers through the proxy's `export *` passthrough, which
 *    preserves live bindings.
 *
 * Parsing uses acorn -- an established parser, no custom ESM parsing.
 */

import { parse } from 'acorn'

export type ExportKind = 'function' | 'wrap' | 'skip'

export type ModuleAnalysis = {
  /** Named exports (default excluded), in declaration order. */
  exports: { name: string; kind: ExportKind }[]
  defaultKind: 'none' | 'function' | 'class' | 'wrap'
  /** Sources of `export * from '...'` statements, for name chasing. */
  starSources: string[]
  /** True when the file looks like CommonJS rather than ESM. */
  cjs: boolean
}

type AcornNode = {
  type: string
  start: number
  end: number
  [key: string]: unknown
}

const FUNCTION_INITS = new Set(['ArrowFunctionExpression', 'FunctionExpression'])

function collectLocalKinds(body: AcornNode[]): Map<string, ExportKind> {
  const kinds = new Map<string, ExportKind>()

  const record = (name: string | undefined, kind: ExportKind) => {
    if (name) kinds.set(name, kind)
  }

  for (const node of body) {
    const target =
      node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration'
        ? (node.declaration as AcornNode | null)
        : node
    if (!target) continue

    switch (target.type) {
      case 'FunctionDeclaration':
        record((target.id as AcornNode & { name?: string })?.name, 'function')
        break
      case 'ClassDeclaration':
        record((target.id as AcornNode & { name?: string })?.name, 'skip')
        break
      case 'VariableDeclaration': {
        const mutable = target.kind !== 'const'
        for (const declarator of target.declarations as AcornNode[]) {
          const id = declarator.id as AcornNode & { name?: string }
          if (id.type !== 'Identifier' || !id.name) continue
          if (mutable) {
            record(id.name, 'skip')
            continue
          }
          const init = declarator.init as AcornNode | null
          record(id.name, init && FUNCTION_INITS.has(init.type) ? 'function' : 'wrap')
        }
        break
      }
      case 'ImportDeclaration':
        for (const spec of target.specifiers as AcornNode[]) {
          const local = spec.local as AcornNode & { name?: string }
          record(local?.name, 'wrap') // imported binding, kind unknown
        }
        break
    }
  }
  return kinds
}

function exportedName(node: AcornNode): string | undefined {
  const n = node as AcornNode & { name?: string; value?: unknown }
  if (n.type === 'Identifier') return n.name
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value
  return undefined
}

const CJS_RE = /\b(module\.exports|exports\.[A-Za-z_$])/

export function analyzeModuleSource(code: string): ModuleAnalysis {
  const analysis: ModuleAnalysis = {
    exports: [],
    defaultKind: 'none',
    starSources: [],
    cjs: false,
  }

  let program: AcornNode
  try {
    program = parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowHashBang: true,
    }) as unknown as AcornNode
  } catch {
    // Not parseable as a module (e.g. CJS using top-level `return`).
    analysis.cjs = CJS_RE.test(code)
    return analysis
  }

  const body = program.body as AcornNode[]
  const localKinds = collectLocalKinds(body)
  const seen = new Set<string>()

  const addExport = (name: string | undefined, kind: ExportKind) => {
    if (!name || seen.has(name)) return
    seen.add(name)
    analysis.exports.push({ name, kind })
  }

  let sawEsmSyntax = false

  for (const node of body) {
    switch (node.type) {
      case 'ImportDeclaration':
        sawEsmSyntax = true
        break

      case 'ExportNamedDeclaration': {
        sawEsmSyntax = true
        const declaration = node.declaration as AcornNode | null
        if (declaration) {
          if (declaration.type === 'FunctionDeclaration') {
            addExport((declaration.id as AcornNode & { name?: string })?.name, 'function')
          } else if (declaration.type === 'ClassDeclaration') {
            addExport((declaration.id as AcornNode & { name?: string })?.name, 'skip')
          } else if (declaration.type === 'VariableDeclaration') {
            for (const declarator of declaration.declarations as AcornNode[]) {
              const id = declarator.id as AcornNode & { name?: string }
              if (id.type !== 'Identifier' || !id.name) continue
              addExport(id.name, localKinds.get(id.name) ?? 'wrap')
            }
          }
          break
        }
        const source = node.source as AcornNode | null
        for (const spec of (node.specifiers ?? []) as AcornNode[]) {
          const exported = exportedName(spec.exported as AcornNode)
          if (!exported) continue
          if (exported === 'default') {
            // `export { x as default }` / `export { default } from '...'`
            if (analysis.defaultKind === 'none') {
              const local = exportedName(spec.local as AcornNode)
              const kind = source ? 'wrap' : (local && localKinds.get(local)) || 'wrap'
              analysis.defaultKind = kind === 'function' ? 'function' : 'wrap'
            }
            continue
          }
          if (source) {
            addExport(exported, 'wrap')
          } else {
            const local = exportedName(spec.local as AcornNode)
            addExport(exported, (local && localKinds.get(local)) || 'wrap')
          }
        }
        break
      }

      case 'ExportDefaultDeclaration': {
        sawEsmSyntax = true
        const declaration = node.declaration as AcornNode
        if (
          declaration.type === 'FunctionDeclaration' ||
          declaration.type === 'FunctionExpression' ||
          declaration.type === 'ArrowFunctionExpression'
        ) {
          analysis.defaultKind = 'function'
        } else if (
          declaration.type === 'ClassDeclaration' ||
          declaration.type === 'ClassExpression'
        ) {
          analysis.defaultKind = 'class'
        } else if (declaration.type === 'Identifier') {
          const kind = localKinds.get((declaration as AcornNode & { name: string }).name)
          analysis.defaultKind = kind === 'function' ? 'function' : kind === 'skip' ? 'wrap' : 'wrap'
        } else {
          analysis.defaultKind = 'wrap'
        }
        break
      }

      case 'ExportAllDeclaration': {
        sawEsmSyntax = true
        const source = node.source as AcornNode & { value?: unknown }
        const exported = node.exported as AcornNode | null
        if (exported) {
          // `export * as ns from '...'` -- a namespace object export.
          addExport(exportedName(exported), 'wrap')
        } else if (typeof source?.value === 'string') {
          analysis.starSources.push(source.value)
        }
        break
      }
    }
  }

  if (!sawEsmSyntax && CJS_RE.test(code)) {
    analysis.cjs = true
  }

  return analysis
}
