/**
 * Mocking after module evaluation: stable wrappers dispatch per call.
 */

import { expect, test } from './fixtures'

const foo = test.mock('./dependency', 'foo')

test('a mock registered after mount affects the next invocation', async ({ mount }) => {
  const component = await mount('demo/Recalc/Default')
  await expect(component.locator('output')).toHaveText('20')

  foo.mockReturnValue(999)
  await foo.sync()

  await component.getByRole('button', { name: 'recalc' }).click()
  await expect(component.locator('output')).toHaveText('999')
})
