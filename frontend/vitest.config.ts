import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/e2e/**'],
    // Isolate each test file's module environment to prevent vi.mock() factories
    // in one file from receiving real module state loaded by another file that
    // runs concurrently (e.g. pgnUtils.test.ts loading real chessops alongside
    // useRepertoireBuilder.test.ts which mocks it).
    isolate: true,
  },
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
})
