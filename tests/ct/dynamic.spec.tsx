/**
 * Dynamic import: `import('./heavy')` resolves through the same proxy
 * redirection as static imports. A mock registered before the lazy module
 * loads attaches the moment it evaluates.
 */

import { LazyCompute } from '../../src/demo/LazyCompute'
import { expect, test } from './fixtures'

test('mock applies to a lazily imported module', async ({ mount, mock }) => {
  const compute = mock('./heavy', 'compute')
  compute.mockReturnValue(-1)

  const component = await mount(<LazyCompute />)
  await expect(component.locator('output')).toHaveText('idle')

  await component.getByRole('button', { name: 'compute' }).click()

  await expect(component.locator('output')).toHaveText('-1')
  await expect(compute).toHaveBeenCalledWith(7)
})

test('lazily imported module keeps original behavior unmocked', async ({ mount }) => {
  const component = await mount(<LazyCompute />)

  await component.getByRole('button', { name: 'compute' }).click()

  await expect(component.locator('output')).toHaveText('49')
})
