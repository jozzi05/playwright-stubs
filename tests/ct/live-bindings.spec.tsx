/**
 * Mutable `export let` bindings are deliberately not wrapped: they stay live
 * through the proxy's `export *` passthrough. Function exports of the same
 * module remain mockable.
 */

import { CounterPanel } from '../../src/demo/CounterPanel'
import { expect, test } from './fixtures'

test('a mutable binding stays live through the proxy', async ({ mount }) => {
  const component = await mount(<CounterPanel />)
  await expect(component.locator('output')).toHaveText('0')

  await component.getByRole('button', { name: 'increment' }).click()
  await expect(component.locator('output')).toHaveText('1')

  await component.getByRole('button', { name: 'increment' }).click()
  await expect(component.locator('output')).toHaveText('2')
})

test('mocking the mutator stops the live binding from changing', async ({ mount, mock }) => {
  const increment = mock('./counter', 'increment')
  increment.mockReturnValue(999)

  const component = await mount(<CounterPanel />)

  await component.getByRole('button', { name: 'increment' }).click()

  // The real increment never ran, so the live binding still reads 0.
  await expect(component.locator('output')).toHaveText('0')
  await expect(increment).toHaveBeenCalledTimes(1)
})
