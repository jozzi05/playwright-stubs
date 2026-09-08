/**
 * Dependency mocking declared at file top for hook-free setup.
 */

import { expect, test } from './fixtures'

test.mock('./dependency', 'foo').mockReturnValue(777)

test('file-level mock applies before mount', async ({ mount }) => {
  const component = await mount('demo/Component/Default')

  await expect(component.getByText('777')).toBeVisible()
})
