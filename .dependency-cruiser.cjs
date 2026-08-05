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
      to: { path: '^(src/tui(/|$)|node_modules/(ink|ink-text-input|ink-spinner|react)(/|$))' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    // Without these, an ESM-only package that ships an `exports` map — Ink is
    // exactly this — comes back `couldNotResolve`, and a rule that names it can
    // never fire. The guard then reports "no violations" for `src/core`
    // importing Ink directly, which is worse than having no guard at all.
    // Verified: with these options a core -> ink import is reported as an error;
    // without them it passes silently.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'node', 'default'],
      mainFields: ['module', 'main'],
    },
  },
};
