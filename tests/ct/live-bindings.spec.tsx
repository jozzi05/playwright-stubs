/**
 * Mutable `export let` bindings stay live; function exports remain mockable.
 */

import { expect, test } from './fixtures'

const increment = test.mock('./counter', 'increment')

test('a mutable binding stays live through the proxy', async ({ mount }) => {
  increment.mockRestore()

  const component = await mount('demo/CounterPanel/Default')
  await expect(component.locator('output')).toHaveText('0')

  await component.getByRole('button', { name: 'increment' }).click()
  await expect(component.locator('output')).toHaveText('1')

  await component.getByRole('button', { name: 'increment' }).click()
  await expect(component.locator('output')).toHaveText('2')
})

test('mocking the mutator stops the live binding from changing', async ({ mount }) => {
  increment.mockReturnValue(999)

  const component = await mount('demo/CounterPanel/Default')

  await component.getByRole('button', { name: 'increment' }).click()

  await expect(component.locator('output')).toHaveText('0')
  await expect(increment).toHaveBeenCalledTimes(1)
})
