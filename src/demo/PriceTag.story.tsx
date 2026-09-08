import { PriceTag } from './PriceTag'

export function Default({ cents = 1999 }: { cents?: number }) {
  return <PriceTag cents={cents} />
}
