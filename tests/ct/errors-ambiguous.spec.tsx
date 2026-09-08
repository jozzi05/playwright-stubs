import { expect, test } from './fixtures'

const ambiguous = test.mock('dependency', 'foo')

test('an ambiguous specifier fails listing all candidates', async ({ mount }) => {
  await mount('demo/DupPanel/Default')

  await expect(ambiguous.calls()).rejects.toThrow(
    /ambiguous.*src\/demo\/dependency\.ts.*src\/demo\/dup\/dependency\.ts/s,
  )
})
