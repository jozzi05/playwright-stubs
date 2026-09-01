/**
 * Isolation under parallel execution (brief Goal F, §69): every test installs
 * a different value for the same export; each browser context must see only
 * its own. Interleaved unmocked tests must see the original.
 */

import { Component } from '../../src/demo/Component'
import { expect, test } from './fixtures'

for (let i = 0; i < 25; i++) {
  test(`parallel mock ${i} sees its own value`, async ({ mount, mock }) => {
    const foo = mock('./dependency', 'foo')
    foo.mockReturnValue(1000 + i)

    const component = await mount(<Component />)

    await expect(component.getByText(String(1000 + i))).toBeVisible()
    await expect(foo).toHaveBeenCalledTimes(1)
  })

  test(`parallel unmocked ${i} sees the original`, async ({ mount }) => {
    const component = await mount(<Component />)

    await expect(component.getByText('20')).toBeVisible()
  })
}
