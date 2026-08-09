import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // next-auth statically imports `next/server`; next has no `exports` map for
    // that subpath, so Vite's default externalized Node ESM resolver can't find
    // it without an explicit extension. Inlining next-auth routes it through
    // Vite's own resolver instead, which handles the extension-less lookup.
    server: {
      deps: {
        inline: ['next-auth'],
      },
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
