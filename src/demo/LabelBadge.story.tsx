import { LabelBadge } from './LabelBadge'

export function Default({ active = true }: { active?: boolean }) {
  return <LabelBadge active={active} />
}
