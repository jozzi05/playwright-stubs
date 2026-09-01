import { nextLabel } from './sequence'

export function SequenceList() {
  const labels = [nextLabel(), nextLabel(), nextLabel()]
  return (
    <ul>
      {labels.map((label, index) => (
        <li key={index}>{label}</li>
      ))}
    </ul>
  )
}
