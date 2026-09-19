import { defineConfig } from 'vitest/config'
import base from './vitest.config.ts'
export default defineConfig({
  ...base,
  test: {
    include: ['tests/**/*.integration.test.ts'],
    exclude: [],
    hookTimeout: 180000,
    testTimeout: 30000,
    fileParallelism: false,
  },
})
