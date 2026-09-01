/**
 * Default exports: default-exported functions are mocked under the export
 * name "default"; default-exported plain objects get per-method mocking via
 * "default.<method>" with `this` preserved.
 */

import { ClientPanel } from '../../src/demo/ClientPanel'
import { PriceTag } from '../../src/demo/PriceTag'
import { expect, test } from './fixtures'

test('default-exported function is mockable', async ({ mount, mock }) => {
  const formatPrice = mock('./formatter', 'default')
  formatPrice.mockReturnValue('FREE')

  const component = await mount(<PriceTag cents={1999} />)

  await expect(component.locator('output')).toHaveText('FREE')
  await expect(formatPrice).toHaveBeenCalledWith(1999)
})

test('default-exported function keeps original behavior unmocked', async ({ mount }) => {
  const component = await mount(<PriceTag cents={1999} />)

  await expect(component.locator('output')).toHaveText('$19.99')
})

test('default-exported object preserves `this` across methods unmocked', async ({ mount }) => {
  const component = await mount(<ClientPanel />)

  await expect(component.locator('output')).toHaveText('GET https://real.example/users')
})

test('default-exported object methods are mockable individually', async ({ mount, mock }) => {
  const get = mock('./client', 'default.get')
  get.mockReturnValue('GET https://mocked.example/users')

  const component = await mount(<ClientPanel />)

  await expect(component.locator('output')).toHaveText('GET https://mocked.example/users')
  await expect(get).toHaveBeenCalledWith('/users')
})

test('mocking one method leaves the others intact', async ({ mount, mock }) => {
  const endpoint = mock('./client', 'default.endpoint')
  endpoint.mockReturnValue('https://intercepted.example/x')

  const component = await mount(<ClientPanel />)

  // `get` still runs for real, calling the mocked `endpoint` through `this`.
  await expect(component.locator('output')).toHaveText('GET https://intercepted.example/x')
})
