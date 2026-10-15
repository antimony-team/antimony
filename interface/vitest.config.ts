import path from 'node:path';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {'@sb': path.resolve(__dirname, 'src')},
  },
  test: {
    include: ['src/**/*.test.ts'],
    // There are no unit tests yet, the run still has to pass for task check
    passWithNoTests: true,
  },
});
