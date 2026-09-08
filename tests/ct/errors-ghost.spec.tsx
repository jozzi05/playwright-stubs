import { expect, test } from './fixtures'

const ghost = test.mock('./ghost', 'spooky')

test('a mock for a never-loaded module reports at inspection time', async ({ mount }) => {
  await mount('demo/Component/Default')

  await expect(ghost.calls()).rejects.toThrow(/never attached to a loaded module/)

  ghost.mockRestore()
  await ghost.sync()
})
