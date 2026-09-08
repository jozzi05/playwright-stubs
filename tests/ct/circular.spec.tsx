/**
 * Circular dependencies, including evaluation-time calls across the cycle.
 */

import { expect, test } from './fixtures'

const fromB = test.mock('./circ-b', 'fromB')

test('circular modules evaluate and run unmocked', async ({ mount }) => {
  fromB.mockRestore()

  const component = await mount('demo/CircularPanel/Default')

  await expect(component.getByTestId('combo')).toHaveText('B+A')
  await expect(component.getByTestId('early')).toHaveText('A')
})

test('a function inside the cycle is mockable', async ({ mount }) => {
  fromB.mockReturnValue('MOCK')

  const component = await mount('demo/CircularPanel/Default')

  await expect(component.getByTestId('combo')).toHaveText('MOCK+A')
  await expect(component.getByTestId('early')).toHaveText('A')
})
