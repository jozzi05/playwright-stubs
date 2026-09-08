import { expect, test } from './fixtures'

const dupFoo = test.mock('./dup/dependency', 'foo')

test('a longer path disambiguates two same-named modules', async ({ mount }) => {
  dupFoo.mockReturnValue(-1)

  const component = await mount('demo/DupPanel/Default')

  await expect(component.getByTestId('dup')).toHaveText('-1')
  await expect(component.getByTestId('main')).toHaveText('2')
})
