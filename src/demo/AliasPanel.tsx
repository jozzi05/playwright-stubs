import { foo } from '@demo/dependency'

export function AliasPanel() {
  return <div>{foo(10)}</div>
}
