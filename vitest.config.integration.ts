import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/api/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      $shared: new URL('./shared', import.meta.url).pathname,
      $lib: new URL('./src/lib', import.meta.url).pathname,
      $server: new URL('./server', import.meta.url).pathname,
    },
  },
});
