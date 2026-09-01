import { fromB } from './circ-b'

export function fromA(): string {
  return 'A'
}

export function combo(): string {
  return `${fromB()}+A`
}
