import { fromA } from './circ-a'

// Evaluation-time call across the cycle: works with plain ESM because
// function declarations are hoisted during instantiation, and must keep
// working through the generated proxies.
export const early = fromA()

export function fromB(): string {
  return 'B'
}
