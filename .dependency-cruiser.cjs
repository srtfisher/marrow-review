module.exports = {
  forbidden: [
    {
      name: 'core-must-not-import-ui',
      severity: 'error',
      comment: 'src/core must stay UI-free so it can back a non-terminal frontend later.',
      from: { path: '^src/core' },
      // Path boundaries matter: an unanchored '^src/tui' also matches a future
      // 'src/tuition', which would report a violation against non-UI code and
      // teach everyone to ignore this rule. Verified both directions.
      to: { path: '^(src/tui(/|$)|node_modules/(ink|ink-text-input|react)(/|$))' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
