import { test as ctBase } from '@playwright/experimental-ct-react'
import { withMocks } from '../../src/playwright/fixture'

export const test = withMocks(ctBase)
export { expect } from '../../src/playwright/assertions'
