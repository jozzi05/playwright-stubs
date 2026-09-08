/**
 * Matcher ergonomics: asymmetric matchers, nth/last call assertions.
 */

import { expect, test } from './fixtures'

const track = test.mock('./analytics', 'track')

test('asymmetric matchers work against recorded arguments', async ({ mount }) => {
  const component = await mount('demo/TrackButton/Default')
  await component.getByRole('button', { name: 'send' }).click()
  await component.getByRole('button', { name: 'send' }).click()

  await expect(track).toHaveBeenCalledTimes(2)
  await expect(track).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'click', meta: expect.objectContaining({ at: expect.any(Number) }) }),
  )
  await expect(track).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: 'click' }))
  await expect(track).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'click' }))
})

test('test.mock.module mocks several exports at once', async ({ mount }) => {
  const { getUser } = test.mock.module('./api', {
    getUser: async (id: string) => ({ id, name: `Module ${id}` }),
  })

  const component = await mount('demo/UserProfile/Default', { id: '7' })

  await expect(component.getByText('Module 7')).toBeVisible()
  await expect(getUser).toHaveBeenCalledWith('7')
})
