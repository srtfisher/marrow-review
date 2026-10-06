module.exports = {
  forbidden: [
    {
      name: 'core-must-not-import-ui-or-http',
      severity: 'error',
      comment: 'src/core is the library every frontend shares: no UI, no HTTP server.',
      from: { path: '^src/core' },
      // Path boundaries matter: an unanchored '^src/web' also matches a future
      // 'src/webhooks', which would report a violation against non-UI code and
      // teach everyone to ignore this rule.
      to: { path: '^(src/(web|server|cli)(/|$)|node_modules/(react|react-dom)(/|$))' },
    },
    {
      name: 'server-must-not-import-web',
      severity: 'error',
      comment: 'The server serves the built page; it never imports its source.',
      from: { path: '^src/server' },
      to: { path: '^src/web(/|$)' },
    },
    {
      name: 'web-imports-core-types-only',
      severity: 'error',
      comment: 'The page runs in a browser: it may share core types, never core code.',
      from: { path: '^src/web' },
      to: { path: '^src/(core|server|cli)(/|$)', dependencyTypesNot: ['type-only'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.web.json' },
    tsPreCompilationDeps: true,
    // Without these, an ESM-only package that ships an `exports` map comes back
    // `couldNotResolve`, and a rule that names it can never fire — the guard
    // then reports "no violations" for exactly the import it exists to catch.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'node', 'default'],
      mainFields: ['module', 'main'],
      extensions: ['.ts', '.tsx', '.js'],
    },
  },
};
