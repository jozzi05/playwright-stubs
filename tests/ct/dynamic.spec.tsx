/**
 * Dynamic import resolves through the same proxy as static imports.
 */

import { expect, test } from './fixtures'

const compute = test.mock('./heavy', 'compute')

test('mock applies to a lazily imported module', async ({ mount }) => {
  compute.mockReturnValue(-1)

  const component = await mount('demo/LazyCompute/Default')
  await expect(component.locator('output')).toHaveText('idle')

  await component.getByRole('button', { name: 'compute' }).click()

  await expect(component.locator('output')).toHaveText('-1')
  await expect(compute).toHaveBeenCalledWith(7)
})

test('lazily imported module keeps original behavior unmocked', async ({ mount }) => {
  compute.mockRestore()

  const component = await mount('demo/LazyCompute/Default')

  await component.getByRole('button', { name: 'compute' }).click()

  await expect(component.locator('output')).toHaveText('49')
})
