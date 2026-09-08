import { expect, test } from './fixtures'

const bad = test.mock('./dependency', 'fooo')

test('mocking a nonexistent export fails with the available list', async ({ mount }) => {
  await mount('demo/Component/Default')

  await expect(bad.calls()).rejects.toThrow(/no mockable export "fooo".*Mockable exports: foo/s)
})
