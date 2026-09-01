/**
 * Namespace imports (`import * as calc`): the namespace object is the proxy
 * module's own namespace, so its members are the same shared wrappers named
 * imports get -- no extra mechanism involved.
 */

import { CalcPanel } from '../../src/demo/CalcPanel'
import { expect, test } from './fixtures'

test('namespace member is mockable; siblings stay original', async ({ mount, mock }) => {
  const add = mock('./calc', 'add')
  add.mockReturnValue(1000)

  const component = await mount(<CalcPanel />)

  await expect(component.getByTestId('add')).toHaveText('1000')
  await expect(component.getByTestId('mul')).toHaveText('6')
  await expect(add).toHaveBeenCalledWith(2, 3)
})

test('namespace usage keeps original behavior unmocked', async ({ mount }) => {
  const component = await mount(<CalcPanel />)

  await expect(component.getByTestId('add')).toHaveText('5')
  await expect(component.getByTestId('mul')).toHaveText('6')
})
