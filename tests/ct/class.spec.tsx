/**
 * Class exports pass through untouched; sibling function exports stay mockable.
 */

import { expect, test } from './fixtures'

const makeGreeting = test.mock('./greeter', 'makeGreeting')

test('class exports construct normally through the proxy', async ({ mount }) => {
  const component = await mount('demo/GreeterPanel/Default')

  await expect(component.getByTestId('direct')).toHaveText('Hello Direct')
  await expect(component.getByTestId('made')).toHaveText('Hello Made')
})

test('function exports next to a class are mockable', async ({ mount }) => {
  makeGreeting.mockReturnValue('Servus')

  const component = await mount('demo/GreeterPanel/Default')

  await expect(component.getByTestId('made')).toHaveText('Servus')
  await expect(component.getByTestId('direct')).toHaveText('Hello Direct')
  await expect(makeGreeting).toHaveBeenCalledWith('Made')
})
