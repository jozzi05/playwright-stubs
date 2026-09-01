/**
 * Real npm packages, no allowlist: clsx ships ESM, classnames ships CJS.
 * Both are proxied like any source module and mocked by bare package name.
 */

import { LabelBadge } from '../../src/demo/LabelBadge'
import { expect, test } from './fixtures'

test('npm packages keep original behavior unmocked', async ({ mount }) => {
  const component = await mount(<LabelBadge active={true} />)

  await expect(component.getByTestId('clsx')).toHaveText('badge active')
  await expect(component.getByTestId('classnames')).toHaveText('label active')
})

test('an ESM package export is mockable by package name', async ({ mount, mock }) => {
  const clsx = mock('clsx', 'clsx')
  clsx.mockReturnValue('mocked-badge')

  const component = await mount(<LabelBadge active={true} />)

  await expect(component.getByTestId('clsx')).toHaveText('mocked-badge')
  await expect(component.getByTestId('classnames')).toHaveText('label active')
  await expect(clsx).toHaveBeenCalledWith('badge', { active: true })
})

test('a CJS package default export is mockable', async ({ mount, mock }) => {
  const classNames = mock('classnames', 'default')
  classNames.mockReturnValue('mocked-label')

  const component = await mount(<LabelBadge active={true} />)

  await expect(component.getByTestId('classnames')).toHaveText('mocked-label')
  await expect(component.getByTestId('clsx')).toHaveText('badge active')
})
