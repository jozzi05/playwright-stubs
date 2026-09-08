/**
 * `test.mock(...)` at the top of the file -- the vi.mock/jest.mock syntax.
 */

import { expect, test } from './fixtures'

test.mock('./api', 'getUser').mockResolvedValue({ id: 't', name: 'Top Level' })
test.mock.module('./calc', {
  add: (a: number, b: number) => a + b + 100,
})

const getUser = test.mock('./api', 'getUser')
const add = test.mock('./calc', 'add')

test('a top-level mock applies with zero test-body ceremony', async ({ mount }) => {
  const component = await mount('demo/UserProfile/Default', { id: 't' })

  await expect(component.getByText('Top Level')).toBeVisible()
})

test('it applies to every test in the file, each on a fresh page', async ({ mount }) => {
  const component = await mount('demo/UserProfile/Default', { id: 't' })

  await expect(component.getByText('Top Level')).toBeVisible()
})

test('the test body can inspect calls of a top-level mock', async ({ mount }) => {
  const component = await mount('demo/UserProfile/Default', { id: 't' })

  await expect(component.getByText('Top Level')).toBeVisible()
  await expect(getUser).toHaveBeenCalledWith('t')
})

test('the test body overrides a top-level mock', async ({ mount }) => {
  getUser.mockResolvedValue({ id: 't', name: 'Overridden' })

  const component = await mount('demo/UserProfile/Default', { id: 't' })

  await expect(component.getByText('Overridden')).toBeVisible()
})

test('an unused top-level mock does not fail tests that never load it', async ({ mount }) => {
  const component = await mount('demo/Component/Default')

  await expect(component.getByText('20')).toBeVisible()
})

test('test.mock.module declarations apply too', async ({ mount }) => {
  const component = await mount('demo/CalcPanel/Default')

  await expect(component.getByTestId('add')).toHaveText('105')
  await expect(component.getByTestId('mul')).toHaveText('6')
  await expect(add).toHaveBeenCalledWith(2, 3)
})
