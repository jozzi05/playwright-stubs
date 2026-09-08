/**
 * Namespace imports share the same stable wrappers as named imports.
 */

import { expect, test } from './fixtures'

const add = test.mock('./calc', 'add')

test('namespace member is mockable; siblings stay original', async ({ mount }) => {
  add.mockReturnValue(1000)

  const component = await mount('demo/CalcPanel/Default')

  await expect(component.getByTestId('add')).toHaveText('1000')
  await expect(component.getByTestId('mul')).toHaveText('6')
  await expect(add).toHaveBeenCalledWith(2, 3)
})

test('namespace usage keeps original behavior unmocked', async ({ mount }) => {
  add.mockRestore()

  const component = await mount('demo/CalcPanel/Default')

  await expect(component.getByTestId('add')).toHaveText('5')
  await expect(component.getByTestId('mul')).toHaveText('6')
})
