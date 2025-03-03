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
      'webpack.common.cjs',
      'webpack.prod.cjs',
      'webpack.dev.cjs',
      'workbox-config.cjs',
      'eslint.config.js',
      '.prettierrc.cjs',
      'start.js',
      'server/*',
    ],
  },
  ...fixupConfigRules(
    compat.extends(
      'eslint:recommended',
      'plugin:@typescript-eslint/recommended',
      'plugin:jsx-control-statements/recommended',
      'plugin:import/recommended',
      './node_modules/gts'
    )
  ),
  {
    plugins: {
      '@typescript-eslint': fixupPluginRules(typescriptEslintEslintPlugin),
      'unused-imports': unusedImports,
      import: fixupPluginRules(_import),
      'jsx-control-statements': fixupPluginRules(jsxControlStatements),
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
        project: './tsconfig.json',
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
    },
  },
];
