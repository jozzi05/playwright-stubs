/**
 * Circular dependencies, including an evaluation-time call across the cycle.
 * Hoisted proxy wrappers keep function declarations reachable during module
 * instantiation, exactly like plain ESM.
 */

import { CircularPanel } from '../../src/demo/CircularPanel'
import { expect, test } from './fixtures'

test('circular modules evaluate and run unmocked', async ({ mount }) => {
  const component = await mount(<CircularPanel />)

  await expect(component.getByTestId('combo')).toHaveText('B+A')
  await expect(component.getByTestId('early')).toHaveText('A')
})

test('a function inside the cycle is mockable', async ({ mount, mock }) => {
  const fromB = mock('./circ-b', 'fromB')
  fromB.mockReturnValue('MOCK')

  const component = await mount(<CircularPanel />)

  await expect(component.getByTestId('combo')).toHaveText('MOCK+A')
  // The evaluation-time value was computed before any mock could matter.
  await expect(component.getByTestId('early')).toHaveText('A')
})
