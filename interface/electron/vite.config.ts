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
          // The main process is an ES module, but bundled CommonJS dependencies such as yaml still call require
          vite: {
            build: {
              rollupOptions: {
                output: {
                  // A global property, so minifying doesn't rename it
                  banner:
                    "import {createRequire} from 'node:module'; globalThis.require ??= createRequire(import.meta.url);",
                },
              },
            },
          },
        },
        // A sandboxed preload script must be CommonJS, the .cjs extension keeps Electron from loading it as an ES module
        preload: {
          input: 'electron/preload.ts',
          vite: {
            build: {
              rollupOptions: {
                output: {entryFileNames: '[name].cjs'},
              },
            },
          },
        },
        renderer: {},
      }),
      renderer(),
    ],
  }),
);
