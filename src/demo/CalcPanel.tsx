import * as calc from './calc'

export function CalcPanel() {
  return (
    <div>
      <span data-testid="add">{calc.add(2, 3)}</span>
      <span data-testid="mul">{calc.mul(2, 3)}</span>
    </div>
  )
}
