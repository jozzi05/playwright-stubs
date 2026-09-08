/**
 * Describe-scoped mocks via a dedicated file with its own declarations.
 */

import { expect, test } from './fixtures'

test.mock('./api', 'getUser').mockResolvedValue({ id: 'd', name: 'Describe Default' })

test('the file-level mock applies in this scope', async ({ mount }) => {
  const component = await mount('demo/UserProfile/Default', { id: 'd' })

  await expect(component.getByText('Describe Default')).toBeVisible()
})
