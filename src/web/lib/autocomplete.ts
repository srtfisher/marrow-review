export interface TokenQuery {
  start: number;
  query: string;
}

// Two characters minimum so a smiley like ":D" doesn't grab Enter.
export function findEmojiQuery(text: string, caret: number): TokenQuery | null {
  const match = /(^|[\s([{>])(:)([a-z0-9_+-]{2,})$/i.exec(text.slice(0, caret));
  if (!match) return null;
  const query = match[3] ?? '';
  return { start: caret - query.length - 1, query };
}

export function findMentionQuery(text: string, caret: number): TokenQuery | null {
  const match = /(^|[^\w`@])@([A-Za-z0-9-]{0,39})$/.exec(text.slice(0, caret));
  if (!match) return null;
  const query = match[2] ?? '';
  return { start: caret - query.length - 1, query };
}

/** Shortcodes that start with the query first, then ones that contain it. */
export function rankEmoji(query: string, names: string[], limit = 8): string[] {
  const needle = query.toLowerCase();
  const starts = names.filter((n) => n.startsWith(needle)).sort();
  const contains = names.filter((n) => !n.startsWith(needle) && n.includes(needle)).sort();
  return [...starts, ...contains].slice(0, limit);
}

/** Replaces the token being typed with `insert` and a trailing space; returns the new text and caret. */
export function replaceToken(text: string, token: TokenQuery, insert: string): { text: string; caret: number } {
  const before = text.slice(0, token.start);
  const after = text.slice(token.start + 1 + token.query.length);
  const inserted = `${insert} `;
  return { text: before + inserted + after.replace(/^ /, ''), caret: before.length + inserted.length };
}

/** A ```suggestion block holding `code`, placed on its own lines at the caret. */
export function insertSuggestion(text: string, caret: number, code: string): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const lead = before.length === 0 || before.endsWith('\n') ? '' : '\n';
  const block = `${lead}\`\`\`suggestion\n${code}\n\`\`\`\n`;
  return { text: before + block + after, caret: before.length + lead.length + '```suggestion\n'.length + code.length };
}
