module.exports = {
  forbidden: [
    {
      name: 'core-must-not-import-ui',
      severity: 'error',
      comment: 'src/core must stay UI-free so it can back a non-terminal frontend later.',
      from: { path: '^src/core' },
      to: { path: '^(src/tui|node_modules/(ink|ink-text-input|react))' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
