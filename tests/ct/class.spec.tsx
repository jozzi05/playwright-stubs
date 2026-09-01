/**
 * Class exports pass through untouched (constructable, instanceof-safe);
 * sibling function exports stay mockable.
 */

import { GreeterPanel } from '../../src/demo/GreeterPanel'
import { expect, test } from './fixtures'

test('class exports construct normally through the proxy', async ({ mount }) => {
  const component = await mount(<GreeterPanel />)

  await expect(component.getByTestId('direct')).toHaveText('Hello Direct')
  await expect(component.getByTestId('made')).toHaveText('Hello Made')
})

test('function exports next to a class are mockable', async ({ mount, mock }) => {
  const makeGreeting = mock('./greeter', 'makeGreeting')
  makeGreeting.mockReturnValue('Servus')

  const component = await mount(<GreeterPanel />)

  await expect(component.getByTestId('made')).toHaveText('Servus')
  await expect(component.getByTestId('direct')).toHaveText('Hello Direct')
  await expect(makeGreeting).toHaveBeenCalledWith('Made')
})
