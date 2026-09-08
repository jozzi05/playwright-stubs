import { valueAtEvaluation } from './eager-value'

export function EagerPanel() {
  return <div data-testid="eager-value">{valueAtEvaluation}</div>
}
