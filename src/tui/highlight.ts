import { highlight as tokenize, supportsLanguage } from 'cli-highlight';

/**
 * Syntax colouring for the code column of a diff line.
 *
 * This is the one change in the product that takes something away. The palette
 * is built on the rule that a colour means one thing — `theme.ts` says it out
 * loud: *"A diff addition. Nothing else is ever green."* Five colours on every
 * line dissolves that, and being careful does not put it back.
 *
 * So the add/del signal moves out of the code text and into the gutter and the
 * `+`/`-` marker, which is the column the eye already runs down when skimming.
 * Green and red keep meaning exactly what they meant; they stop covering the
 * words. `HIGHLIGHT_THEME` below is where that bargain is kept, and a test
 * asserts it so nobody can quietly reintroduce either colour later.
 */

/** SGR pair as a plain function, so the codes are ours and not chalk's.
 *
 *  `cli-highlight` ships a theme built on its own bundled chalk, which decides
 *  for itself whether colour is on. That makes output depend on ambient TTY
 *  detection two dependencies away — untestable, and it silently emits GREEN
 *  for comments and RED for strings, which is precisely what must never happen
 *  here. Owning the codes makes the reservation checkable. */
const sgr = (open: number, close: number) => (text: string) => `\u001b[${open}m${text}\u001b[${close}m`;

/**
 * highlight.js scope names to styles.
 *
 * Magenta, yellow, and cyan also mean `agent`, `pending`, and `structure`
 * elsewhere in the app. Inside the code column that is tolerable — nobody reads
 * a string literal and wonders whether the model wrote it. What is not
 * tolerable is green or red appearing here, and neither is in this table.
 */
export const HIGHLIGHT_THEME: Record<string, (text: string) => string> = {
  keyword: sgr(35, 39),
  built_in: sgr(35, 39),
  literal: sgr(35, 39),
  string: sgr(33, 39),
  regexp: sgr(33, 39),
  number: sgr(36, 39),
  comment: sgr(2, 22),
  title: sgr(34, 39),
  class: sgr(34, 39),
  function: sgr(34, 39),
  meta: sgr(2, 22),
};

/**
 * Hunks past this get no colour. Highlighting is a nicety and reading the diff
 * is not, so a pathological file degrades rather than stalling the pane.
 */
export const MAX_HIGHLIGHT_LINES = 2000;

const BY_EXTENSION: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  php: 'php', rb: 'ruby', py: 'python', go: 'go', rs: 'rust', java: 'java',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', swift: 'swift',
  kt: 'kotlin', scala: 'scala', sh: 'bash', bash: 'bash', zsh: 'bash',
  css: 'css', scss: 'scss', less: 'less', html: 'xml', xml: 'xml', svg: 'xml',
  json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini',
  sql: 'sql', md: 'markdown', markdown: 'markdown', graphql: 'graphql', gql: 'graphql',
};

/**
 * The grammar for a path, or null when there is none.
 *
 * Null rather than a guess: colouring a file with the wrong grammar is worse
 * than not colouring it, because the colours then assert things about the code
 * that are not true.
 */
export function languageFor(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  // A leading dot is a dotfile, not an extension: `.gitignore` has no grammar.
  if (dot <= 0) return null;

  const language = BY_EXTENSION[name.slice(dot + 1).toLowerCase()];
  return language && supportsLanguage(language) ? language : null;
}

/** Every SGR sequence, with where it sits. */
const SGR = /\u001b\[([0-9;]*)m/g;

/**
 * Splits marked-up text into lines each of which stands on its own.
 *
 * A style that opens on one line and closes on another leaves the first line
 * with an unterminated colour — and a terminal will then paint everything below
 * it, all the way down the diff. This closes the style at the end of the line
 * and reopens it on the next.
 *
 * In practice the tokenizer already terminates its runs at newlines, so this is
 * usually a no-op. It is here because "usually" is not the standard for the one
 * invariant the row model is built on.
 */
export function splitAnsiLines(text: string): string[] {
  const out: string[] = [];
  let open: string[] = [];

  for (const line of text.split('\n')) {
    const prefix = open.join('');
    SGR.lastIndex = 0;

    for (let match = SGR.exec(line); match !== null; match = SGR.exec(line)) {
      const code = match[1] ?? '';
      // A reset, or any of the "back to default" closers, ends the innermost
      // style. Anything else opens one.
      if (code === '' || code === '0') open = [];
      else if (['22', '23', '24', '27', '29', '39', '49'].includes(code)) open.pop();
      else open.push(match[0]);
    }

    out.push(open.length > 0 ? `${prefix}${line}\u001b[0m` : `${prefix}${line}`);
  }

  return out;
}

/**
 * Hunks already coloured, keyed by where they came from.
 *
 * The row list is rebuilt on every keystroke while a comment is being composed,
 * and re-tokenizing every visible hunk that often is the difference between a
 * responsive pane and a laggy one. A hunk's text never changes for the life of
 * a review, so this only ever grows to the size of the pull request.
 */
const cache = new Map<string, string[]>();

/** `highlightHunk`, memoized. The key must name the exact text being coloured. */
export function highlightCached(
  key: string,
  lines: string[],
  language: string | null,
): string[] {
  const hit = cache.get(key);
  if (hit) return hit;

  const coloured = highlightHunk(lines, language);
  cache.set(key, coloured);
  return coloured;
}

/** Between pull requests. Two files can share a path across two reviews. */
export function clearHighlightCache(): void {
  cache.clear();
}

/**
 * A hunk's lines, coloured together and split back apart.
 *
 * Together, because a block comment or a template literal is not a comment or a
 * literal to a tokenizer shown one line of it — and a JSDoc block above a
 * changed function is exactly the thing a reviewer is reading.
 *
 * Every failure returns the input unchanged. A highlighter that threw on one
 * odd file and took the diff down with it would be a bad trade for colour.
 */
export function highlightHunk(lines: string[], language: string | null): string[] {
  if (language === null || lines.length === 0 || lines.length > MAX_HIGHLIGHT_LINES) {
    return lines;
  }

  try {
    const marked = tokenize(lines.join('\n'), {
      language,
      theme: HIGHLIGHT_THEME,
      // A hunk is a slice out of the middle of a file and frequently does not
      // parse on its own.
      ignoreIllegals: true,
    });

    const split = splitAnsiLines(marked);
    // The 1:1 guarantee the row model depends on. If the tokenizer ever
    // returned a different number of lines, plain text is the safe answer.
    return split.length === lines.length ? split : lines;
  } catch {
    return lines;
  }
}
