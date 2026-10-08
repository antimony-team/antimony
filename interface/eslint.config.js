import js from '@eslint/js';
import path from 'node:path';
import globals from 'globals';
import {fileURLToPath} from 'node:url';
import _import from 'eslint-plugin-import';
import {FlatCompat} from '@eslint/eslintrc';
import tsParser from '@typescript-eslint/parser';
import unusedImports from 'eslint-plugin-unused-imports';
import {fixupConfigRules, fixupPluginRules} from '@eslint/compat';
import jsxControlStatements from 'eslint-plugin-jsx-control-statements';
import typescriptEslintEslintPlugin from '@typescript-eslint/eslint-plugin';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import noRelativeImportPaths from 'eslint-plugin-no-relative-import-paths';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  {
    ignores: [
      '**/build/',
      'vite.config.ts',
      'eslint.config.js',
      '.prettierrc.cjs',
      'start.js',
      'server/*',
      'electron/*',
    ],
  },
  ...fixupConfigRules(
    compat.extends(
      'eslint:recommended',
      'plugin:@typescript-eslint/recommended',
      'plugin:jsx-control-statements/recommended',
      'plugin:import/recommended',
      './node_modules/gts',
    ),
  ),
  {
    plugins: {
      '@typescript-eslint': fixupPluginRules(typescriptEslintEslintPlugin),
      'unused-imports': unusedImports,
      import: fixupPluginRules(_import),
      'jsx-control-statements': fixupPluginRules(jsxControlStatements),
      'simple-import-sort': simpleImportSort,
      'no-relative-import-paths': noRelativeImportPaths,
    },

    languageOptions: {
      // globals: {
      //   ...globals.browser,
      //   ...globals.node,
      // },

      parser: tsParser,
      ecmaVersion: 5,
      sourceType: 'module',

      parserOptions: {
        project: ['./tsconfig.json', './e2e/tsconfig.json'],
      },
    },

    settings: {
      'import/resolver': {
        typescript: {
          project: 'src/',
        },
      },
    },

    rules: {
      // We hate unused imports.
      'unused-imports/no-unused-imports': 'error',
      'jsx-control-statements/jsx-jcs-no-undef': 'off',
      'no-control-regex': 'off',

      // Vite query-suffix imports (e.g. `foo?worker`) confuse this rule —
      // the resolver strips the query and inspects the underlying file,
      // which has no default export. TypeScript covers the check via vite/client.
      'import/default': 'off',

      'n/no-unsupported-features/node-builtins': [
        'off',
        {
          version: '>=21.0.0',
          ignores: [],
        },
      ],
      'n/no-unsupported-features/es-builtins': [
        'off',
        {
          version: '>=21.0.0',
          ignores: [],
        },
      ],
      'n/no-extraneous-import': ['off'],

      'no-relative-import-paths/no-relative-import-paths': [
        'error',
        {allowSameFolder: true, rootDir: 'src', prefix: '@sb'},
      ],

      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            // 1. React
            ['^react$', '^react/'],
            // 2. Other packages
            ['^@?\\w'],
            // 3. PrimeReact
            ['^primereact'],
            // 4. Own imports with @sb prefix
            ['^@sb/'],
            // 5. Relative imports
            ['^\\.'],
            // 6. CSS imports
            ['^\\u0000.+\\.(css|scss|sass)$'],
            // 7. The component's own stylesheet (./<name>.sass in the same folder)
            ['^\\u0000\\./[^/]+\\.(css|scss|sass)$'],
          ],
        },
      ],
    },
  },
];
