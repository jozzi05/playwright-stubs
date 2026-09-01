/**
 * `test.mock(...)` at the top of the file -- the vi.mock/jest.mock syntax.
 * Declarations are recorded per file and auto-applied to every test in it,
 * as ambient mocks: tests that never load the module are not penalized.
 */

import { CalcPanel } from '../../src/demo/CalcPanel'
import { Component } from '../../src/demo/Component'
import { UserProfile } from '../../src/demo/UserProfile'
import { expect, test } from './fixtures'

test.mock('./api', 'getUser').mockResolvedValue({ id: 't', name: 'Top Level' })
test.mock.module('./calc', {
  add: (a: number, b: number) => a + b + 100,
})

test('a top-level mock applies with zero test-body ceremony', async ({ mount }) => {
  const component = await mount(<UserProfile id="t" />)

  await expect(component.getByText('Top Level')).toBeVisible()
})

test('it applies to every test in the file, each on a fresh page', async ({ mount }) => {
  const component = await mount(<UserProfile id="t" />)

  await expect(component.getByText('Top Level')).toBeVisible()
})

test('the test body can inspect calls of a top-level mock', async ({ mount, mock }) => {
  const getUser = mock('./api', 'getUser')

  const component = await mount(<UserProfile id="t" />)

  await expect(component.getByText('Top Level')).toBeVisible()
  await expect(getUser).toHaveBeenCalledWith('t')
})

test('the test body overrides a top-level mock', async ({ mount, mock }) => {
  mock('./api', 'getUser').mockResolvedValue({ id: 't', name: 'Overridden' })

  const component = await mount(<UserProfile id="t" />)

  await expect(component.getByText('Overridden')).toBeVisible()
})

test('an unused top-level mock does not fail tests that never load it', async ({ mount }) => {
  // Mounts a component that imports neither ./api nor ./calc; the ambient
  // declarations stay pending and that is fine.
  const component = await mount(<Component />)

  await expect(component.getByText('20')).toBeVisible()
})

test('test.mock.module declarations apply too', async ({ mount, mock }) => {
  const add = mock('./calc', 'add')

  const component = await mount(<CalcPanel />)

  await expect(component.getByTestId('add')).toHaveText('105')
  await expect(component.getByTestId('mul')).toHaveText('6')
  await expect(add).toHaveBeenCalledWith(2, 3)
})
