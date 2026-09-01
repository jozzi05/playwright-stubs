// Mutable live binding: `count` must stay live through the proxy (it is
// deliberately not wrapped); `increment` is a mockable function export.
export let count = 0

export function increment(): number {
  count += 1
  return count
}
