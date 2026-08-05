/**
 * Extracts path patterns the repository declares as generated. This is the
 * maintainers' own statement about what is noise, so it outranks any built-in
 * pattern list in the meat rule engine.
 */
export function parseGeneratedPaths(gitattributes: string): Set<string> {
  const out = new Set<string>();

  for (const raw of gitattributes.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    const pattern = parts[0];
    if (!pattern) continue;

    for (const attr of parts.slice(1)) {
      if (attr === 'linguist-generated' || attr === 'linguist-generated=true') {
        out.add(pattern);
        break;
      }
    }
  }

  return out;
}
