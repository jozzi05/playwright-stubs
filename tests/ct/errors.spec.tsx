/**
 * Diagnostics: bad mocks fail loudly with actionable messages instead of
 * silently running the real implementation.
 */

import { Component } from '../../src/demo/Component'
import { DupPanel } from '../../src/demo/DupPanel'
import { expect, test } from './fixtures'

test('mocking a nonexistent export fails with the available list', async ({ mount, mock }) => {
  const bad = mock('./dependency', 'fooo')

  await mount(<Component />)

  await expect(bad.calls()).rejects.toThrow(/no mockable export "fooo".*Mockable exports: foo/s)
})

test('an ambiguous specifier fails listing all candidates', async ({ mount, mock }) => {
  const ambiguous = mock('dependency', 'foo')

  await mount(<DupPanel />)

  await expect(ambiguous.calls()).rejects.toThrow(
    /ambiguous.*src\/demo\/dependency\.ts.*src\/demo\/dup\/dependency\.ts/s,
  )
})

test('a longer path disambiguates two same-named modules', async ({ mount, mock }) => {
  const dupFoo = mock('./dup/dependency', 'foo')
  dupFoo.mockReturnValue(-1)

  const component = await mount(<DupPanel />)

  await expect(component.getByTestId('dup')).toHaveText('-1')
  await expect(component.getByTestId('main')).toHaveText('2')
})

test('a mock for a never-loaded module reports at inspection time', async ({ mount, mock }) => {
  const ghost = mock('./ghost', 'spooky')

  await mount(<Component />)

  await expect(ghost.calls()).rejects.toThrow(/never attached to a loaded module/)

  // Deliberate opt-out so teardown does not fail this (intentional) test.
  ghost.mockRestore()
  await ghost.sync()
})
