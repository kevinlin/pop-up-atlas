import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'

export default defineConfig({
  base: './',
  // .handoff/ holds job worktrees and set-aside rows, not product tests.
  test: { exclude: [...configDefaults.exclude, '.handoff/**'] },
})
