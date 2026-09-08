import { expect, test } from './fixtures'

const foo = test.mock('./dependency', 'foo')

test.describe.serial('reuseContext lifecycle', () => {
  test('does not leak a configured mock to the next test', async ({ mount }) => {
    foo.mockReturnValue(701)

    const component = await mount('demo/Component/Default')

    await expect(component.getByText('701')).toBeVisible()
  })

  test('starts the next test with the original implementation', async ({ mount }) => {
    const component = await mount('demo/Component/Default')

    await expect(component.getByText('20')).toBeVisible()
  })
})
