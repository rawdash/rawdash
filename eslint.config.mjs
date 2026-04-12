import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '**/*.generated.*',
      '**/*.d.ts',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...eslint.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      curly: 'error',
    },
  },
  ...tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
      files: ['**/*.ts'],
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        globals: { ...globals.node, ...globals.es2022 },
        parserOptions: { tsconfigRootDir: import.meta.dirname },
      },
      rules: {
        curly: 'error',
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        'no-restricted-syntax': [
          'error',
          {
            selector:
              'ImportDeclaration[source.value=/^\\.\\.?\\//][source.value=/\\.(js|ts|tsx|jsx|mjs|cjs)$/]',
            message:
              'Do not use file extensions in relative import specifiers.',
          },
          {
            selector:
              'ExportNamedDeclaration[source.value=/^\\.\\.?\\//][source.value=/\\.(js|ts|tsx|jsx|mjs|cjs)$/]',
            message:
              'Do not use file extensions in relative import specifiers.',
          },
          {
            selector:
              'ExportAllDeclaration[source.value=/^\\.\\.?\\//][source.value=/\\.(js|ts|tsx|jsx|mjs|cjs)$/]',
            message:
              'Do not use file extensions in relative import specifiers.',
          },
          {
            selector:
              'ImportExpression > Literal[value=/^\\.\\.?\\//][value=/\\.(js|ts|tsx|jsx|mjs|cjs)$/]',
            message:
              'Do not use file extensions in relative import specifiers.',
          },
        ],
      },
    },
  ),
];
