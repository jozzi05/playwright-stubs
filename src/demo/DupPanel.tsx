import { foo } from './dependency'
import { foo as dupFoo } from './dup/dependency'

/** Loads two modules that share a basename, to exercise ambiguity handling. */
export function DupPanel() {
  return (
    <div>
      <span data-testid="main">{foo(1)}</span>
      <span data-testid="dup">{dupFoo(1)}</span>
    </div>
  )
}
