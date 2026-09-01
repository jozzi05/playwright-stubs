/**
 * Once-queue semantics (brief §32): once-implementations are consumed in
 * order, then dispatch falls back to the default implementation, then to the
 * original.
 */

import { SequenceList } from '../../src/demo/SequenceList'
import { expect, test } from './fixtures'

test('once values are consumed in order, then fall back to the original', async ({
  mount,
  mock,
}) => {
  const nextLabel = mock('./sequence', 'nextLabel')

  nextLabel.mockReturnValueOnce('first').mockReturnValueOnce('second')

  const component = await mount(<SequenceList />)

  const items = component.getByRole('listitem')
  await expect(items).toHaveText(['first', 'second', 'original'])
  await expect(nextLabel).toHaveBeenCalledTimes(3)
})

test('once values are consumed before the default implementation', async ({ mount, mock }) => {
  const nextLabel = mock('./sequence', 'nextLabel')

  nextLabel.mockReturnValue('default').mockReturnValueOnce('first')

  const component = await mount(<SequenceList />)

  const items = component.getByRole('listitem')
  await expect(items).toHaveText(['first', 'default', 'default'])
})

test('mockReset drops implementation and once-queue but keeps spying', async ({
  mount,
  mock,
}) => {
  const nextLabel = mock('./sequence', 'nextLabel')
  nextLabel.mockReturnValueOnce('a').mockReturnValue('b')
  nextLabel.mockReset()

  const component = await mount(<SequenceList />)

  const items = component.getByRole('listitem')
  await expect(items).toHaveText(['original', 'original', 'original'])
  await expect(nextLabel).toHaveBeenCalledTimes(3)
})
