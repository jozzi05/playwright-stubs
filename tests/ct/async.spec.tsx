/**
 * Async semantics through the real dependency boundary.
 */

import { expect, test } from './fixtures'

const getUser = test.mock('./api', 'getUser')

test('mockResolvedValue renders the mocked user', async ({ mount }) => {
  getUser.mockResolvedValue({ id: '123', name: 'Alice' })

  const component = await mount('demo/UserProfile/Default', { id: '123' })

  await expect(component.getByText('Alice')).toBeVisible()
  await expect(getUser).toHaveBeenCalledWith('123')
})

test('mockRejectedValue renders the error state', async ({ mount }) => {
  getUser.mockRejectedValue(new Error('boom'))

  const component = await mount('demo/UserProfile/Default', { id: '123' })

  await expect(component.getByRole('alert')).toHaveText('failed: boom')
})

test('unmocked async dependency keeps its original behavior', async ({ mount }) => {
  getUser.mockRestore()

  const component = await mount('demo/UserProfile/Default', { id: '123' })

  await expect(component.getByText('Real User')).toBeVisible()
})

test('mockImplementation runs browser-side', async ({ mount }) => {
  getUser.mockImplementation(async (id: string) => ({ id, name: `User ${id}` }))

  const component = await mount('demo/UserProfile/Default', { id: '42' })

  await expect(component.getByText('User 42')).toBeVisible()
})
