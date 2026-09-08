import { test as base } from '@playwright/test'
import { withMocks } from '../../src/playwright/fixture'

export const test = withMocks(base)
export { expect } from '../../src/playwright/assertions'
