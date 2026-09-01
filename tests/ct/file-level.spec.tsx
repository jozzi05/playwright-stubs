/**
 * Mocking outside the test body -- the vi.mock/jest.mock analog.
 *
 * Three styles:
 *  1. file-level `test.use({ mocks })`: applied before every test in the file;
 *  2. describe-level `test.use({ mocks })`: overrides the file default in scope;
 *  3. `test.beforeEach(({ mock }) => ...)`: plain Playwright hooks work too.
 */

import { UserProfile } from '../../src/demo/UserProfile'
import { Component } from '../../src/demo/Component'
import { defineMocks, expect, test } from './fixtures'

test.use({
  mocks: defineMocks((mock) => {
    mock('./api', 'getUser').mockResolvedValue({ id: 'f', name: 'File Default' })
  }),
})

test('file-level mocks apply without touching the test body', async ({ mount }) => {
  const component = await mount(<UserProfile id="f" />)

  await expect(component.getByText('File Default')).toBeVisible()
})

test('file-level mocks apply to every test, on a fresh page each time', async ({ mount }) => {
  const component = await mount(<UserProfile id="f" />)

  await expect(component.getByText('File Default')).toBeVisible()
})

test('the test body can inspect and layer on top of file-level mocks', async ({
  mount,
  mock,
}) => {
  // Same specifier + export resolves to the same underlying mock state.
  const getUser = mock('./api', 'getUser')

  const component = await mount(<UserProfile id="f" />)

  await expect(component.getByText('File Default')).toBeVisible()
  await expect(getUser).toHaveBeenCalledWith('f')
})

test('a later command from the test body wins over the file default', async ({
  mount,
  mock,
}) => {
  mock('./api', 'getUser').mockResolvedValue({ id: 'f', name: 'Body Override' })

  const component = await mount(<UserProfile id="f" />)

  await expect(component.getByText('Body Override')).toBeVisible()
})

test.describe('describe-level override', () => {
  test.use({
    mocks: defineMocks((mock) => {
      mock('./api', 'getUser').mockResolvedValue({ id: 'd', name: 'Describe Default' })
    }),
  })

  test('the nested option replaces the file-level one in this scope', async ({ mount }) => {
    const component = await mount(<UserProfile id="d" />)

    await expect(component.getByText('Describe Default')).toBeVisible()
  })
})

test.describe('beforeEach hooks', () => {
  test.use({ mocks: undefined }) // opt out of the file default in this scope

  test.beforeEach(async ({ mock }) => {
    mock('./dependency', 'foo').mockReturnValue(777)
  })

  test('fixtures are available in hooks, so beforeEach mocking just works', async ({
    mount,
  }) => {
    const component = await mount(<Component />)

    await expect(component.getByText('777')).toBeVisible()
  })
})
