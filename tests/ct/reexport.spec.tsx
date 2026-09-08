/**
 * Re-export facades: mockable via facade and origin module specifiers.
 */

import { expect, test } from './fixtures'

const fetchProfile = test.mock('./services', 'fetchProfile')
const fetchProfileOrigin = test.mock('./services/profile', 'fetchProfile')
const getSetting = test.mock('./services', 'getSetting')

test('named re-export is mockable via the facade specifier', async ({ mount }) => {
  fetchProfile.mockResolvedValue({ id: '1', alias: 'facade-mock' })

  const component = await mount('demo/ProfilePanel/Default', { id: '1' })

  await expect(component.getByTestId('alias')).toHaveText('facade-mock')
  await expect(fetchProfile).toHaveBeenCalledWith('1')
})

test('named re-export is mockable via its origin module', async ({ mount }) => {
  fetchProfileOrigin.mockResolvedValue({ id: '1', alias: 'origin-mock' })

  const component = await mount('demo/ProfilePanel/Default', { id: '1' })

  await expect(component.getByTestId('alias')).toHaveText('origin-mock')
})

test('star re-exported function is mockable via the facade', async ({ mount }) => {
  getSetting.mockReturnValue('light')

  const component = await mount('demo/ProfilePanel/Default', { id: '1' })

  await expect(component.getByTestId('theme')).toHaveText('light')
  await expect(component.getByTestId('alias')).toHaveText('real-alias')
})

test('value exports pass through the facade untouched', async ({ mount }) => {
  fetchProfile.mockRestore()
  getSetting.mockRestore()

  const component = await mount('demo/ProfilePanel/Default', { id: '1' })

  await expect(component.getByTestId('default-theme')).toHaveText('dark')
  await expect(component.getByTestId('theme')).toHaveText('dark')
})
