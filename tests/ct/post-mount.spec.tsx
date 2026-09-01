/**
 * Mocking after module evaluation (brief §50): stable wrappers dispatch per
 * call, so registering a mock after mount affects future calls without
 * touching values already rendered.
 */

import { Recalc } from '../../src/demo/Recalc'
import { expect, test } from './fixtures'

test('a mock registered after mount affects the next invocation', async ({ mount, mock }) => {
  const component = await mount(<Recalc />)
  await expect(component.locator('output')).toHaveText('20')

  const foo = mock('./dependency', 'foo')
  foo.mockReturnValue(999)
  await foo.sync()

  await component.getByRole('button', { name: 'recalc' }).click()
  await expect(component.locator('output')).toHaveText('999')
})
