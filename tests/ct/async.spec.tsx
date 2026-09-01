/**
 * Async semantics (brief Goal G, §31): resolved and rejected values reach
 * the component through the real dependency boundary -- no page.route, no
 * knowledge of any transport.
 */

import { UserProfile } from '../../src/demo/UserProfile'
import { expect, test } from './fixtures'

test('mockResolvedValue renders the mocked user', async ({ mount, mock }) => {
  const getUser = mock('./api', 'getUser')

  getUser.mockResolvedValue({ id: '123', name: 'Alice' })

  const component = await mount(<UserProfile id="123" />)

  await expect(component.getByText('Alice')).toBeVisible()
  await expect(getUser).toHaveBeenCalledWith('123')
})

test('mockRejectedValue renders the error state', async ({ mount, mock }) => {
  const getUser = mock('./api', 'getUser')

  getUser.mockRejectedValue(new Error('boom'))

  const component = await mount(<UserProfile id="123" />)

  await expect(component.getByRole('alert')).toHaveText('failed: boom')
})

test('unmocked async dependency keeps its original behavior', async ({ mount }) => {
  const component = await mount(<UserProfile id="123" />)

  await expect(component.getByText('Real User')).toBeVisible()
})

test('mockImplementation runs browser-side', async ({ mount, mock }) => {
  const getUser = mock('./api', 'getUser')

  // Closure-free: the function source is shipped to and evaluated in the browser.
  getUser.mockImplementation(async (id: string) => ({ id, name: `User ${id}` }))

  const component = await mount(<UserProfile id="42" />)

  await expect(component.getByText('User 42')).toBeVisible()
})
