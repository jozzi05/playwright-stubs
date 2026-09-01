import { useState } from 'react'
import { foo } from './dependency'

/** Exercises mocking *after* mount: the button re-invokes the dependency. */
export function Recalc() {
  const [value, setValue] = useState(() => foo(10))
  return (
    <div>
      <output>{value}</output>
      <button onClick={() => setValue(foo(10))}>recalc</button>
    </div>
  )
}
