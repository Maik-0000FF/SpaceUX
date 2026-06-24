// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

// ESLint flat config. tsc covers types and Prettier covers formatting; this
// adds the bug-class lint pass in between. The TypeScript source is linted
// type-aware (recommendedTypeChecked) so rules like no-floating-promises and
// switch-exhaustiveness can use real type information; tests get the lighter
// non-type-aware pass. eslint-config-prettier is last so no lint rule fights
// Prettier. (#91)

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

// The source spans two tsconfigs (tsconfig.json: shared/core/tests;
// tsconfig.node.json: main/shared/core/core-host); the type-aware pass needs
// both so every linted file resolves to a program.
const TS_PROJECTS = ['./tsconfig.json', './tsconfig.node.json'];

// Underscore-prefixed bindings are an intentional "unused" marker (placeholder
// callback params, etc.); keep that convention instead of forcing renames.
const UNUSED_VARS = [
  'error',
  { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
];

export default tseslint.config(
  {
    // editor-qt and overlay are QML/C++ land; their *.js files are QML engine
    // scripts (functions invoked from QML, not modules), which the Node/browser
    // lint rules misread as dead code. They sit outside the #91 TS scope.
    ignores: [
      'dist/**',
      'build/**',
      'node_modules/**',
      'coverage/**',
      'vitest.config.ts',
      'src/editor-qt/**',
      'src/overlay/**',
    ],
  },
  {
    // A stale eslint-disable is itself an error, so the directives never rot.
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  js.configs.recommended,
  {
    // Type-aware, strict lint pass for the TypeScript source (#91 scope:
    // core, core-host, main, shared).
    files: ['src/core/**/*.ts', 'src/core-host/**/*.ts', 'src/main/**/*.ts', 'src/shared/**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: TS_PROJECTS,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // console is the host/plugin log surface, but it should be a deliberate,
      // visible choice (the existing eslint-disable comments), not accidental.
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': UNUSED_VARS,
      // Allow the "declare, capture in a closure, assign before the first await"
      // pattern (a binding read before its single assignment can't be const).
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
    },
  },
  {
    // Tests: same bug classes without the type-aware pass, so Vitest idioms
    // don't generate type-only noise.
    files: ['tests/**/*.ts'],
    extends: [tseslint.configs.recommended],
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': UNUSED_VARS,
    },
  },
  prettier,
);
