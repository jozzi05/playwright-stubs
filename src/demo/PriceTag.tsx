import formatPrice from './formatter'

export function PriceTag({ cents }: { cents: number }) {
  return (
    <div>
      price: <output>{formatPrice(cents)}</output>
    </div>
  )
}
