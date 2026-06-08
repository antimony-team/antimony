import {UserConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default function baseConfig(mode: string): UserConfig {
  return {
    plugins: [react({babel: {babelrc: true}})],
    resolve: {
      alias: {'@sb': path.resolve(__dirname, 'src')},
      extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
    },
    server: {
      host: '0.0.0.0',
      port: 8080,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          rewrite: p => p.replace(/^\/api/, ''),
        },
        '/socket.io': {
          target: 'ws://localhost:3000',
          ws: true,
        },
      },
    },
    build: {sourcemap: mode === 'development'},
    worker: {format: 'es'},
    optimizeDeps: {
      include: ['path-browserify', 'monaco-yaml', 'monaco-editor'],
    },
    envPrefix: 'SB_',
    base: './',
  };
}
