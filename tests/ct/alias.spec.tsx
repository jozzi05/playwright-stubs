/**
 * Vite resolve.alias: mocks work when the component imports via alias.
 */

import { expect, test } from './fixtures'

const foo = test.mock('src/demo/dependency', 'foo')

test('mocks a dependency imported through a Vite alias', async ({ mount }) => {
  foo.mockReturnValue(555)

  const component = await mount('demo/AliasPanel/Default')

  await expect(component.getByText('555')).toBeVisible()
})
