import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/poincake/' : '/',
  server: {
    host: '127.0.0.1',
    port: 5173,
    hmr: mode === 'test' ? false : undefined,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
