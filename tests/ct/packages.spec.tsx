/**
 * Real npm packages, no allowlist: clsx ships ESM, classnames ships CJS.
 */

import { expect, test } from './fixtures'

test('npm packages keep original behavior unmocked', async ({ mount }) => {
  const component = await mount('demo/LabelBadge/Default', { active: true })

  await expect(component.getByTestId('clsx')).toHaveText('badge active')
  await expect(component.getByTestId('classnames')).toHaveText('label active')
})
