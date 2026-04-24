// Standalone vitest config for plain-JS unit tests.
// Kept separate from vite.config.js (which is wired to storybook + chromium)
// so `npm test` stays fast and dep-light.

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.{js,jsx}'],
    environment: 'node',
    globals: false,
  },
})
