import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/transform/**/*.test.ts', 'tests/unit/**/*.test.ts'],
  },
})
