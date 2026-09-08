/**
 * File-level `test.mock()` declarations apply to every test in the file.
 */

import { expect, test } from './fixtures'

test.mock('./api', 'getUser').mockResolvedValue({ id: 'f', name: 'File Default' })

const getUser = test.mock('./api', 'getUser')

test('file-level mocks apply without touching the test body', async ({ mount }) => {
  const component = await mount('demo/UserProfile/Default', { id: 'f' })

  await expect(component.getByText('File Default')).toBeVisible()
})

test('file-level mocks apply to every test, on a fresh page each time', async ({ mount }) => {
  const component = await mount('demo/UserProfile/Default', { id: 'f' })

  await expect(component.getByText('File Default')).toBeVisible()
})

test('the test body can inspect file-level mocks', async ({ mount }) => {
  const component = await mount('demo/UserProfile/Default', { id: 'f' })

  await expect(component.getByText('File Default')).toBeVisible()
  await expect(getUser).toHaveBeenCalledWith('f')
})

test('a later command from the test body wins over the file default', async ({ mount }) => {
  getUser.mockResolvedValue({ id: 'f', name: 'Body Override' })

  const component = await mount('demo/UserProfile/Default', { id: 'f' })

  await expect(component.getByText('Body Override')).toBeVisible()
})
