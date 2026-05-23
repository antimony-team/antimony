import {defineConfig, loadEnv, UserConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), '');
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
    build: {outDir: 'build', sourcemap: mode === 'development'},
    worker: {format: 'es'},
    optimizeDeps: {
      include: ['path-browserify', 'monaco-yaml', 'monaco-editor'],
    },
    define: {
      'process.env.SB_API_SERVER_URL': JSON.stringify(env.SB_API_SERVER_URL),
      'process.env.SB_CLAB_SCHEMA_URL': JSON.stringify(env.SB_CLAB_SCHEMA_URL),
      'process.env.NODE_ENV': JSON.stringify(mode),
    },
  };
});
