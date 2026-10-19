import react from '@vitejs/plugin-react';
import path from 'node:path';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  // The stores and the history use MobX decorators, which only babel compiles
  plugins: [react({babel: {babelrc: true}})],
  resolve: {
    alias: {'@sb': path.resolve(__dirname, 'src')},
  },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*-types.ts'],
    },
  },
});
