import { foo } from './dependency'

export function Component() {
  return <div>{foo(10)}</div>
}
