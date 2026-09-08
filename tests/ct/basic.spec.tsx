/**
 * The "suggested first coding task" from the brief (§102), verbatim:
 * mock a named function import, assert the mocked render and the call
 * arguments, and prove the original behavior survives in a sibling test.
 */

import { expect, test } from './fixtures'

const foo = test.mock('./dependency', 'foo')

test('mocked dependency drives the render', async ({ mount }) => {
  foo.mockReturnValue(999)

  const component = await mount('demo/Component/Default')

  await expect(component.getByText('999')).toBeVisible()
  await expect(foo).toHaveBeenCalledWith(10)
  await expect(foo).toHaveBeenCalledTimes(1)
})

test('original implementation is used when nothing is mocked', async ({ mount }) => {
  const component = await mount('demo/Component/Default')

  await expect(component.getByText('20')).toBeVisible()
})

test('a bare mock acts as a spy: passthrough plus call recording', async ({ mount }) => {
  const component = await mount('demo/Component/Default')

  await expect(component.getByText('20')).toBeVisible()
  await expect(foo).toHaveBeenCalledWith(10)
})

test('mockRestore removes the stub entirely', async ({ mount }) => {
  foo.mockReturnValue(999)
  foo.mockRestore()

  const component = await mount('demo/Component/Default')

  await expect(component.getByText('20')).toBeVisible()
})

test('the mock specifier can also be a root-relative module path', async ({ mount }) => {
  const aliased = test.mock('src/demo/dependency', 'foo')
  aliased.mockReturnValue(777)

  const component = await mount('demo/Component/Default')

  await expect(component.getByText('777')).toBeVisible()
})
