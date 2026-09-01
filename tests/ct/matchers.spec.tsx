/**
 * Matcher ergonomics: asymmetric matchers, nth/last call assertions, and the
 * mock.module() convenience.
 */

import { TrackButton } from '../../src/demo/TrackButton'
import { UserProfile } from '../../src/demo/UserProfile'
import { expect, test } from './fixtures'

test('asymmetric matchers work against recorded arguments', async ({ mount, mock }) => {
  const track = mock('./analytics', 'track')

  const component = await mount(<TrackButton />)
  await component.getByRole('button', { name: 'send' }).click()
  await component.getByRole('button', { name: 'send' }).click()

  await expect(track).toHaveBeenCalledTimes(2)
  await expect(track).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'click', meta: expect.objectContaining({ at: expect.any(Number) }) }),
  )
  await expect(track).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: 'click' }))
  await expect(track).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'click' }))
})

test('mock.module mocks several exports at once', async ({ mount, mock }) => {
  const { getUser } = mock.module('./api', {
    getUser: async (id: string) => ({ id, name: `Module ${id}` }),
  })

  const component = await mount(<UserProfile id="7" />)

  await expect(component.getByText('Module 7')).toBeVisible()
  await expect(getUser).toHaveBeenCalledWith('7')
})
