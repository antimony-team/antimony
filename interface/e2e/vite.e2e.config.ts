import path from 'node:path';
import {UserConfig} from 'vite';

import baseConfig from '../vite.config';
import {BACKEND_URL, E2E_DIR, INTERFACE_PORT, TMP_DIR} from './settings';

// The server's paths that Antimony Desktop calls without the /api prefix
const DESKTOP_PATHS = [
  '/users',
  '/collections',
  '/topologies',
  '/labs',
  '/server-config',
  '/devices',
  '/clab-schema',
];

/*
 * Builds the interface like the production image does and serves it with `vite preview`.
 *
 * Like the production image, the browser talks to /api and /socket.io on its own origin, the default of the
 * interface, and the preview server proxies both to the backend.
 *
 * Antimony Desktop talks to the server's paths directly, without /api. The desktop tests point it at this
 * origin, so those paths are proxied as well.
 */
export default ({mode}: {mode: string}): UserConfig => {
  const config = baseConfig(mode);
  const backendProxy = {
    '/api': {
      target: BACKEND_URL,
      changeOrigin: true,
      rewrite: (requestPath: string) => requestPath.replace(/^\/api/, ''),
    },
    '/socket.io': {
      target: BACKEND_URL.replace(/^http/, 'ws'),
      ws: true,
      changeOrigin: true,
    },
    ...Object.fromEntries(
      DESKTOP_PATHS.map(prefix => [
        prefix,
        {target: BACKEND_URL, changeOrigin: true},
      ]),
    ),
  };

  return {
    ...config,
    root: path.join(E2E_DIR, '..'),
    build: {
      ...config.build,
      outDir: path.join(TMP_DIR, 'dist'),
      emptyOutDir: true,
    },
    preview: {
      host: '127.0.0.1',
      port: INTERFACE_PORT,
      strictPort: true,
      proxy: backendProxy,
    },
  };
};
