import { test as ctBase } from '@playwright/experimental-ct-react'
import { withMocks } from '../../src/playwright/fixture'

export const test = withMocks(ctBase)
export { defineMocks } from '../../src/playwright/fixture'
export { expect } from '../../src/playwright/assertions'
