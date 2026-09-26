import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const desktopRoot = resolve(__dirname, '../emdash-desktop');

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      '@core': resolve(desktopRoot, 'src/core'),
      '@web': resolve(__dirname, 'web'),
    },
  },
  test: {
    include: ['web/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
  },
});
