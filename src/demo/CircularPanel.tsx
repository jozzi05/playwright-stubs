import { combo } from './circ-a'
import { early } from './circ-b'

export function CircularPanel() {
  return (
    <div>
      <span data-testid="combo">{combo()}</span>
      <span data-testid="early">{early}</span>
    </div>
  )
}
