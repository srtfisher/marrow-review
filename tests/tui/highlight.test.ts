import { test, expect, describe } from 'bun:test';
import {
  HIGHLIGHT_THEME, MAX_HIGHLIGHT_LINES, highlightHunk, languageFor, splitAnsiLines,
} from '../../src/tui/highlight.js';

const strip = (text: string) => text.replaceAll(/\u001b\[[0-9;]*m/g, '');

describe('languageFor', () => {
  test('names the grammar for the extensions a pull request is made of', () => {
    expect(languageFor('src/app.ts')).toBe('typescript');
    expect(languageFor('src/App.tsx')).toBe('typescript');
    expect(languageFor('src/main.js')).toBe('javascript');
    expect(languageFor('wp-content/plugin.php')).toBe('php');
    expect(languageFor('styles/app.scss')).toBe('scss');
    expect(languageFor('package.json')).toBe('json');
  });

  test('is null for anything with no grammar, rather than guessing', () => {
    expect(languageFor('LICENSE')).toBeNull();
    expect(languageFor('.gitignore')).toBeNull();
    expect(languageFor('assets/logo.png')).toBeNull();
  });
});

describe('the theme', () => {
  // The one rule the palette cannot bend. Green means an addition and red means
  // a deletion, everywhere, and a syntax token that could wear either would
  // make a line of context look like a change.
  test('reserves green and red by never using them', () => {
    for (const [scope, style] of Object.entries(HIGHLIGHT_THEME)) {
      const codes = style('x').match(/\u001b\[(\d+)m/g) ?? [];
      expect(codes, `${scope} must not use green`).not.toContain('\u001b[32m');
      expect(codes, `${scope} must not use red`).not.toContain('\u001b[31m');
    }
  });

  test('closes every style it opens', () => {
    for (const style of Object.values(HIGHLIGHT_THEME)) {
      expect(strip(style('x'))).toBe('x');
    }
  });
});

describe('splitAnsiLines', () => {
  test('leaves plain text alone', () => {
    expect(splitAnsiLines('one\ntwo')).toEqual(['one', 'two']);
  });

  test('repairs a style that runs across a line break', () => {
    // Split naively, the first line opens a style it never closes and the
    // terminal colours everything after it to the bottom of the screen.
    const lines = splitAnsiLines('\u001b[35mone\ntwo\u001b[39m');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('\u001b[35m');
    expect(lines[0]!.endsWith('\u001b[0m')).toBe(true);
    expect(lines[1]).toContain('\u001b[35m');
    expect(strip(lines.join('\n'))).toBe('one\ntwo');
  });

  test('does not touch a style that closes on its own line', () => {
    expect(splitAnsiLines('\u001b[35mone\u001b[39m\ntwo')).toEqual([
      '\u001b[35mone\u001b[39m', 'two',
    ]);
  });

  test('keeps the text intact whatever the codes do', () => {
    const text = "const x = 'a';\n// note\nreturn x;";
    expect(strip(splitAnsiLines(text).join('\n'))).toBe(text);
  });
});

describe('highlightHunk', () => {
  const lines = ["const s = 'hi';", 'let n = 42;'];

  test('colours the code without changing a character of it', () => {
    const out = highlightHunk(lines, 'typescript');

    expect(out).toHaveLength(2);
    expect(out.map(strip)).toEqual(lines);
    expect(out[0]).toContain('\u001b[');
  });

  test('gives back one string per line it was given', () => {
    // The invariant the whole row model rests on: rows and lines are 1:1, and
    // a highlighter that merged or split any would put the cursor off by one.
    const block = ['/* a comment', '   that spans lines */', 'const x = 1;'];
    expect(highlightHunk(block, 'typescript')).toHaveLength(3);
  });

  test('highlights the hunk whole, so a block comment reads as one comment', () => {
    // Line by line, `   that spans lines */` is not a comment to any tokenizer
    // and would come out as ordinary code.
    const block = ['/* a comment', '   that spans lines */'];
    expect(highlightHunk(block, 'typescript')[1]).toContain('\u001b[');
  });

  test('hands back the input untouched when there is no grammar', () => {
    expect(highlightHunk(lines, null)).toEqual(lines);
  });

  test('hands back the input untouched on a hunk too big to be worth it', () => {
    const huge = Array.from({ length: MAX_HIGHLIGHT_LINES + 1 }, () => 'const x = 1;');
    expect(highlightHunk(huge, 'typescript')).toEqual(huge);
  });

  test('survives a fragment that is not valid on its own', () => {
    // A hunk is a slice out of the middle of a file and frequently does not
    // parse. It must still be readable.
    const fragment = ['  } else if (x) {', '    return null;'];
    expect(highlightHunk(fragment, 'typescript').map(strip)).toEqual(fragment);
  });

  test('an empty hunk is not an error', () => {
    expect(highlightHunk([], 'typescript')).toEqual([]);
  });
});
