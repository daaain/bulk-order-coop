import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/api/**/*.test.ts'],
  },
  resolve: {
    alias: {
      $shared: new URL('./shared', import.meta.url).pathname,
      $lib: new URL('./src/lib', import.meta.url).pathname,
      $server: new URL('./server', import.meta.url).pathname,
    },
  },
});
