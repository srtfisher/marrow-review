import { test, expect, describe } from 'bun:test';
import {
  findEmojiQuery, findMentionQuery, insertSuggestion, rankEmoji, replaceToken,
} from '../../src/web/lib/autocomplete.js';
import { parseRoute, parseTarget } from '../../src/web/lib/format.js';

describe('emoji', () => {
  test('a shortcode after a space opens the picker', () => {
    expect(findEmojiQuery('nice :ta', 8)).toEqual({ start: 5, query: 'ta' });
  });

  test('a colon inside a word or a one-letter smiley does not', () => {
    expect(findEmojiQuery('http://x', 8)).toBeNull();
    expect(findEmojiQuery('ok :D', 5)).toBeNull();
  });

  test('prefix matches rank before substring matches', () => {
    expect(rankEmoji('ta', ['metal', 'tada', 'taco'])).toEqual(['taco', 'tada', 'metal']);
  });

  test('choosing replaces the token with the shortcode', () => {
    expect(replaceToken('nice :ta', { start: 5, query: 'ta' }, ':tada:')).toEqual({ text: 'nice :tada: ', caret: 12 });
  });
});

describe('mentions', () => {
  test('an @ after a space opens the picker, an email address does not', () => {
    expect(findMentionQuery('cc @oct', 7)).toEqual({ start: 3, query: 'oct' });
    expect(findMentionQuery('a@b', 3)).toBeNull();
  });
});

describe('insertSuggestion', () => {
  test('puts the block on its own line and the caret after the code', () => {
    const { text, caret } = insertSuggestion('Try:', 4, 'x = 1');
    expect(text).toBe('Try:\n```suggestion\nx = 1\n```\n');
    expect(text.slice(0, caret).endsWith('x = 1')).toBe(true);
  });
});

describe('routes', () => {
  test('reads a pull request from the hash', () => {
    expect(parseRoute('#/o/r/42')).toEqual({ owner: 'o', repo: 'r', number: 42 });
    expect(parseRoute('#/')).toEqual({ owner: null, repo: null, number: null });
  });

  test('accepts a URL, a reference, or a number', () => {
    expect(parseTarget('https://github.com/o/r/pull/7')).toEqual({ owner: 'o', repo: 'r', number: 7 });
    expect(parseTarget('o/r#7')).toEqual({ owner: 'o', repo: 'r', number: 7 });
    expect(parseTarget('o/r')).toEqual({ owner: 'o', repo: 'r', number: null });
    expect(parseTarget('#7')).toEqual({ owner: null, repo: null, number: 7 });
    expect(parseTarget('not a thing')).toBeNull();
  });
});
