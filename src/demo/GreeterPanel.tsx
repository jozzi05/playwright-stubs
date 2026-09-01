import { Greeter, makeGreeting } from './greeter'

export function GreeterPanel() {
  const direct = new Greeter().greet('Direct')
  return (
    <div>
      <span data-testid="direct">{direct}</span>
      <span data-testid="made">{makeGreeting('Made')}</span>
    </div>
  )
}
