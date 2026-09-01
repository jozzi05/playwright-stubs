import { useState } from 'react'

/** The dependency is loaded lazily via dynamic import, on demand. */
export function LazyCompute() {
  const [result, setResult] = useState<number | null>(null)

  const run = async () => {
    const { compute } = await import('./heavy')
    setResult(compute(7))
  }

  return (
    <div>
      <button onClick={run}>compute</button>
      <output>{result === null ? 'idle' : result}</output>
    </div>
  )
}
