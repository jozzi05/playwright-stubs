/**
 * Once-queue semantics: once-implementations consumed in order, then default/original.
 */

import { expect, test } from './fixtures'

const nextLabel = test.mock('./sequence', 'nextLabel')

test('once values are consumed in order, then fall back to the original', async ({ mount }) => {
  nextLabel.mockReturnValueOnce('first').mockReturnValueOnce('second')

  const component = await mount('demo/SequenceList/Default')

  const items = component.getByRole('listitem')
  await expect(items).toHaveText(['first', 'second', 'original'])
  await expect(nextLabel).toHaveBeenCalledTimes(3)
})

test('once values are consumed before the default implementation', async ({ mount }) => {
  nextLabel.mockReset()
  nextLabel.mockReturnValue('default').mockReturnValueOnce('first')

  const component = await mount('demo/SequenceList/Default')

  const items = component.getByRole('listitem')
  await expect(items).toHaveText(['first', 'default', 'default'])
})

test('mockReset drops implementation and once-queue but keeps spying', async ({ mount }) => {
  nextLabel.mockReturnValueOnce('a').mockReturnValue('b')
  nextLabel.mockReset()

  const component = await mount('demo/SequenceList/Default')

  const items = component.getByRole('listitem')
  await expect(items).toHaveText(['original', 'original', 'original'])
  await expect(nextLabel).toHaveBeenCalledTimes(3)
})
