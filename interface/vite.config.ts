import {UserConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {execSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';

// CI sets the version from the release tag, other builds have the development version 0.0.0-dev
const {version} = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'),
);

// The commit the build is made from: passed to the Docker build, set by GitHub Actions, or the local checkout
function buildCommit(): string | null {
  const commit = process.env.SB_COMMIT || process.env.GITHUB_SHA;
  if (commit) return commit.slice(0, 7);

  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

export default function baseConfig(mode: string): UserConfig {
  return {
    plugins: [react({babel: {babelrc: true}})],
    define: {
      'import.meta.env.SB_VERSION': JSON.stringify(version),
      'import.meta.env.SB_COMMIT': JSON.stringify(buildCommit()),
    },
    resolve: {
      alias: {'@sb': path.resolve(__dirname, 'src')},
      extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3100',
          changeOrigin: true,
          rewrite: p => p.replace(/^\/api/, ''),
        },
        '/socket.io': {
          target: 'ws://localhost:3100',
          ws: true,
          changeOrigin: true,
        },
      },
      cors: {
        origin: true,
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
