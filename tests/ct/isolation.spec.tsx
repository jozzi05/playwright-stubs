/**
 * Isolation under parallel execution: every test installs a different value
 * for the same export; each browser context must see only its own.
 */

import { expect, test } from './fixtures'

const foo = test.mock('./dependency', 'foo')

for (let i = 0; i < 25; i++) {
  test(`parallel mock ${i} sees its own value`, async ({ mount }) => {
    foo.mockReturnValue(1000 + i)

    const component = await mount('demo/Component/Default')

    await expect(component.getByText(String(1000 + i))).toBeVisible()
    await expect(foo).toHaveBeenCalledTimes(1)
  })

  test(`parallel unmocked ${i} sees the original`, async ({ mount }) => {
    foo.mockRestore()

    const component = await mount('demo/Component/Default')

    await expect(component.getByText('20')).toBeVisible()

    foo.mockReset()
  })
}
