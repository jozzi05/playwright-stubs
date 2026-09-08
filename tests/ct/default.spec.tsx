/**
 * Default exports: functions under "default", object methods under "default.<method>".
 */

import { expect, test } from './fixtures'

const formatPrice = test.mock('./formatter', 'default')
const get = test.mock('./client', 'default.get')
const endpoint = test.mock('./client', 'default.endpoint')

test('default-exported function is mockable', async ({ mount }) => {
  formatPrice.mockReturnValue('FREE')

  const component = await mount('demo/PriceTag/Default', { cents: 1999 })

  await expect(component.locator('output')).toHaveText('FREE')
  await expect(formatPrice).toHaveBeenCalledWith(1999)
})

test('default-exported function keeps original behavior unmocked', async ({ mount }) => {
  formatPrice.mockRestore()

  const component = await mount('demo/PriceTag/Default', { cents: 1999 })

  await expect(component.locator('output')).toHaveText('$19.99')
})

test('default-exported object preserves `this` across methods unmocked', async ({ mount }) => {
  get.mockRestore()
  endpoint.mockRestore()

  const component = await mount('demo/ClientPanel/Default')

  await expect(component.locator('output')).toHaveText('GET https://real.example/users')
})

test('default-exported object methods are mockable individually', async ({ mount }) => {
  get.mockReturnValue('GET https://mocked.example/users')

  const component = await mount('demo/ClientPanel/Default')

  await expect(component.locator('output')).toHaveText('GET https://mocked.example/users')
  await expect(get).toHaveBeenCalledWith('/users')
})

test('mocking one method leaves the others intact', async ({ mount }) => {
  get.mockRestore()
  endpoint.mockReturnValue('https://intercepted.example/x')

  const component = await mount('demo/ClientPanel/Default')

  await expect(component.locator('output')).toHaveText('GET https://intercepted.example/x')
})
