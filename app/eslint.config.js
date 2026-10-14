import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // AI code never edits the manuscript itself; a chosen version goes in only through editor/aiApply.ts
    // (the author's "Use" click: one undoable step, and only if the passage is unchanged).
    files: ['src/ai/**', 'src/ui/components/AiEditorPanel.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name=/^(commands|chain|dispatch|insertContent|setContent)$/]",
          message: 'AI code must not edit the manuscript directly. Offer the result with a Use button (editor/aiApply.ts).',
        },
      ],
    },
  },
);
