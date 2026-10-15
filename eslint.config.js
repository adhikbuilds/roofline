import tseslint from 'typescript-eslint';

const NODE_BUILTINS = [
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dns', 'events', 'fs', 'http', 'https',
  'net', 'os', 'path', 'perf_hooks', 'process', 'readline', 'stream', 'timers', 'tls', 'url', 'util',
  'vm', 'worker_threads', 'zlib',
];

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/coverage/**', 'docs/**'] },
  ...tseslint.configs.recommended,
  {
    // The engine is pure: no clock, no randomness, no Node, no env, no internal packages.
    files: ['packages/engine/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: 'Engine is pure: inject `now` instead of calling Date.now().',
        },
        {
          selector: "MemberExpression[object.name='Date'][computed=true][property.value='now']",
          message: 'Engine is pure: inject `now` instead of calling Date.now().',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Engine is pure: inject `now` instead of calling new Date().',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: 'Engine is pure: inject a seeded RNG instead of Math.random().',
        },
        {
          selector: "MemberExpression[object.name='Math'][computed=true][property.value='random']",
          message: 'Engine is pure: inject a seeded RNG instead of Math.random().',
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Engine must not read process.env: accept an injected env object.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: NODE_BUILTINS.map((name) => ({ name, message: 'Engine must not import Node built-ins.' })),
          patterns: [
            { group: ['node:*'], message: 'Engine must not import node:* modules.' },
            { group: ['@roofline/*'], message: 'Engine must not import other workspace packages.' },
          ],
        },
      ],
    },
  },
);
