import classNames from 'classnames'
import { clsx } from 'clsx'

/** Uses real npm packages: clsx (ESM) and classnames (CJS). */
export function LabelBadge({ active }: { active: boolean }) {
  return (
    <div>
      <span data-testid="clsx">{clsx('badge', { active })}</span>
      <span data-testid="classnames">{classNames('label', { active })}</span>
    </div>
  )
}
