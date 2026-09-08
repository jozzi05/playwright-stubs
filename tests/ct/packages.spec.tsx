/**
 * Real npm packages, no allowlist: clsx ships ESM, classnames ships CJS.
 * Both are proxied like any source module and mocked by bare package name.
 */

import { expect, test } from './fixtures'

test('npm packages keep original behavior unmocked', async ({ mount }) => {
  const component = await mount('demo/LabelBadge/Default', { active: true })

  await expect(component.getByTestId('clsx')).toHaveText('badge active')
  await expect(component.getByTestId('classnames')).toHaveText('label active')
})

const clsx = test.mock('clsx', 'clsx')

test('an ESM package export is mockable by package name', async ({ mount }) => {
  clsx.mockReturnValue('mocked-badge')

  const component = await mount('demo/LabelBadge/Default', { active: true })

  await expect(component.getByTestId('clsx')).toHaveText('mocked-badge')
  await expect(component.getByTestId('classnames')).toHaveText('label active')
  await expect(clsx).toHaveBeenCalledWith('badge', { active: true })
})

const classNames = test.mock('classnames', 'default')

test('a CJS package default export is mockable', async ({ mount }) => {
  classNames.mockReturnValue('mocked-label')

  const component = await mount('demo/LabelBadge/Default', { active: true })

  await expect(component.getByTestId('classnames')).toHaveText('mocked-label')
  await expect(component.getByTestId('clsx')).toHaveText('badge active')
})
