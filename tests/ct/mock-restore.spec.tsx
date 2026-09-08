import { expect, test } from './fixtures'

const foo = test.mock('./dependency', 'foo')

test('mockRestore calls the original and stops recording new calls', async ({ mount }) => {
  foo.mockReturnValue(999)
  const component = await mount('demo/Recalc/Default')

  await expect(component.locator('output')).toHaveText('999')
  await expect(foo).toHaveBeenCalledTimes(1)

  foo.mockRestore()
  await foo.sync()
  await component.getByRole('button', { name: 'recalc' }).click()

  await expect(component.locator('output')).toHaveText('20')
  await expect(foo).toHaveBeenCalledTimes(1)
})
