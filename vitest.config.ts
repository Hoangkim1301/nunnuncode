import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Each package is a test project with its own config; `pnpm test` at the
    // root runs them all. Per-package runs resolve that package's config.
    projects: ['packages/*', 'apps/*'],
  },
})
