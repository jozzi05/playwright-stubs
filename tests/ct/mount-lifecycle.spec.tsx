import { expect, test } from './fixtures'

const foo = test.mock('./dependency', 'foo')

test('installs mocks before the lazy story import evaluates', async ({ mount }) => {
  foo.mockReturnValue(321)

  const component = await mount('demo/EagerPanel/Default')

  // EagerPanel reads this value during module evaluation, not during render.
  await expect(component.getByTestId('eager-value')).toHaveText('321')
  await expect(foo).toHaveBeenCalledWith(10)
})

test('replays test-body mock configuration after a second gallery navigation', async ({ mount }) => {
  foo.mockReturnValue(654)

  const first = await mount('demo/Component/Default')
  await expect(first.getByText('654')).toBeVisible()

  const second = await mount('demo/Component/Default')
  await expect(second.getByText('654')).toBeVisible()

  // A navigation creates a fresh document, so browser-side call history starts
  // afresh while mock configuration is replayed.
  await expect(foo).toHaveBeenCalledTimes(1)
})
