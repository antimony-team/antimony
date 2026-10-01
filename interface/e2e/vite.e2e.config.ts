import path from 'node:path';
import {UserConfig} from 'vite';

import baseConfig from '../vite.config';
import {BACKEND_URL, E2E_DIR, INTERFACE_PORT, TMP_DIR} from './settings';

/*
 * Builds the interface like the production image does and serves it with `vite preview`.
 *
 * The API and socket server URLs come from e2e/.env (the same values as docker/.env), so the browser
 * talks to /api and /socket.io on its own origin and the preview server proxies both to the backend.
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
  };

  return {
    ...config,
    root: path.join(E2E_DIR, '..'),
    envDir: E2E_DIR,
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
