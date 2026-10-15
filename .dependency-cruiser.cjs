/** Enforces PLAN.md section 4.2 package boundaries. */
const pkg = (name) => `^packages/${name}/`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'engine-imports-nothing-internal',
      comment: 'engine may import nothing from other workspace packages or apps',
      severity: 'error',
      from: { path: pkg('engine') + 'src' },
      to: { path: ['^packages/(db|ingest)/', '^apps/'] },
    },
    {
      name: 'engine-no-workspace-packages',
      severity: 'error',
      from: { path: pkg('engine') },
      to: { path: '@roofline/' },
    },
    {
      name: 'engine-no-node-builtins',
      comment: 'engine is pure',
      severity: 'error',
      from: { path: pkg('engine') + 'src' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'db-no-ingest-or-web',
      severity: 'error',
      from: { path: pkg('db') },
      to: { path: ['^packages/ingest/', '^apps/web/', '@roofline/(ingest|web)'] },
    },
    {
      name: 'ingest-no-web',
      severity: 'error',
      from: { path: pkg('ingest') },
      to: { path: ['^apps/web/', '@roofline/web'] },
    },
    {
      name: 'web-no-ingest',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: ['^packages/ingest/', '@roofline/ingest'] },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    exclude: { path: ['/\\.next/', '/node_modules/', '/coverage/'] },
  },
};
