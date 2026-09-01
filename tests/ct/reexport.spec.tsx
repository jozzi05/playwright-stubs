/**
 * Re-export facades: `export { x } from` and `export * from` chains. The
 * export is mockable both under the facade's id and under its origin module,
 * because every hop in the chain is proxied.
 */

import { ProfilePanel } from '../../src/demo/ProfilePanel'
import { expect, test } from './fixtures'

test('named re-export is mockable via the facade specifier', async ({ mount, mock }) => {
  const fetchProfile = mock('./services', 'fetchProfile')
  fetchProfile.mockResolvedValue({ id: '1', alias: 'facade-mock' })

  const component = await mount(<ProfilePanel id="1" />)

  await expect(component.getByTestId('alias')).toHaveText('facade-mock')
  await expect(fetchProfile).toHaveBeenCalledWith('1')
})

test('named re-export is mockable via its origin module', async ({ mount, mock }) => {
  const fetchProfile = mock('./services/profile', 'fetchProfile')
  fetchProfile.mockResolvedValue({ id: '1', alias: 'origin-mock' })

  const component = await mount(<ProfilePanel id="1" />)

  await expect(component.getByTestId('alias')).toHaveText('origin-mock')
})

test('star re-exported function is mockable via the facade', async ({ mount, mock }) => {
  const getSetting = mock('./services', 'getSetting')
  getSetting.mockReturnValue('light')

  const component = await mount(<ProfilePanel id="1" />)

  await expect(component.getByTestId('theme')).toHaveText('light')
  await expect(component.getByTestId('alias')).toHaveText('real-alias')
})

test('value exports pass through the facade untouched', async ({ mount }) => {
  const component = await mount(<ProfilePanel id="1" />)

  await expect(component.getByTestId('default-theme')).toHaveText('dark')
  await expect(component.getByTestId('theme')).toHaveText('dark')
})
