import { track } from './analytics'

export function TrackButton() {
  return (
    <div>
      <button onClick={() => track({ name: 'click', meta: { at: Date.now() } })}>send</button>
    </div>
  )
}
