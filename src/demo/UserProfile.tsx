import { useEffect, useState } from 'react'
import { getUser } from './api'

type State =
  | { status: 'loading' }
  | { status: 'ready'; name: string }
  | { status: 'error'; message: string }

export function UserProfile({ id }: { id: string }) {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    getUser(id).then(
      (user) => {
        if (!cancelled) setState({ status: 'ready', name: user.name })
      },
      (error: Error) => {
        if (!cancelled) setState({ status: 'error', message: error.message })
      },
    )
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <section>
      {state.status === 'loading' && <div>loading…</div>}
      {state.status === 'error' && <div role="alert">failed: {state.message}</div>}
      {state.status === 'ready' && <div>{state.name}</div>}
    </section>
  )
}
