import tseslint from 'typescript-eslint';

// Code-style rules from the design document §17. Installed and pinned during bootstrap.
const GENERIC_NAMES = ['data', 'result', 'res', 'tmp', 'temp', 'obj', 'val', 'info', 'stuff', 'thing', 'foo', 'bar'];

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', 'apps/mobile/ios/**', 'apps/mobile/android/**', 'ml/**', 'scripts/**', 'tools/capture-receiver/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      'id-denylist': ['error', ...GENERIC_NAMES],
      'no-restricted-syntax': [
        'error',
        { selector: 'Identifier[name=/^handle[A-Z]/]', message: 'Name handlers by what they do (for example startReading), not handleX.' },
        { selector: 'CatchClause > BlockStatement[body.length=0]', message: 'Never swallow errors: handle, rethrow, or report them.' },
      ],
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
