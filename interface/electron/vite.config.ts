import {defineConfig, mergeConfig} from 'vite';
import electron from 'vite-plugin-electron/simple';
import renderer from 'vite-plugin-electron-renderer';

import baseConfig from '../vite.config';
export default defineConfig(({mode}) =>
  mergeConfig(baseConfig(mode), {
    plugins: [
      electron({
        main: {
          entry: 'electron/main.ts',
        },
        renderer: {},
      }),
      renderer(),
    ],
    envDir: './electron',
  }),
);
