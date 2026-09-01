import { useState } from 'react'
import { count, increment } from './counter'

export function CounterPanel() {
  const [, rerender] = useState(0)
  return (
    <div>
      <button
        onClick={() => {
          increment()
          rerender((n) => n + 1)
        }}
      >
        increment
      </button>
      {/* Reads the live module binding directly on each render. */}
      <output>{count}</output>
    </div>
  )
}
