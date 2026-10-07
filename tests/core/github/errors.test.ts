import { describe, expect, test } from 'bun:test';
import { describeGitHubError } from '../../../src/core/github/errors.js';

const responded = (status: number, message: string, requestId = 'ABCD:1234') =>
  Object.assign(new Error(message), { status, response: { status, headers: { 'x-github-request-id': requestId } } });

describe('describeGitHubError', () => {
  test('names the status when GitHub answers with an empty body', () => {
    const failure = describeGitHubError(responded(502, ''));
    expect(failure.message).toBe('GitHub answered HTTP 502 without saying why.');
    expect(failure.status).toBe(502);
    expect(failure.requestId).toBe('ABCD:1234');
    expect(failure.onGitHubsSide).toBe(true);
  });

  test('keeps the message GitHub gave and does not blame GitHub for a validation error', () => {
    const failure = describeGitHubError(responded(422, 'Validation Failed: line must be part of the diff'));
    expect(failure.message).toBe('Validation Failed: line must be part of the diff');
    expect(failure.onGitHubsSide).toBe(false);
  });

  test('treats a rate limit as GitHub refusing for now', () => {
    expect(describeGitHubError(responded(429, 'API rate limit exceeded')).onGitHubsSide).toBe(true);
  });

  test('names the network failure behind Octokit\'s fake 500 with a blank message', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 140.82.112.6:443'), { code: 'ECONNREFUSED' });
    const fetchFailed = new TypeError('fetch failed', { cause: new AggregateError([refused], '') });
    const failure = describeGitHubError(Object.assign(new Error(''), { status: 500, cause: fetchFailed }));
    expect(failure.message).toContain('Could not reach GitHub');
    expect(failure.message).toContain('ECONNREFUSED');
    expect(failure.status).toBeNull();
    expect(failure.onGitHubsSide).toBe(true);
  });

  test('never comes back blank, even for a thrown non-error', () => {
    expect(describeGitHubError('').message).not.toBe('');
    expect(describeGitHubError(new Error('   ')).message).not.toBe('');
  });
});

describe('describeGitHubError on an error that never came from a request', () => {
  test('does not blame GitHub for marrow\'s own bug', () => {
    const failure = describeGitHubError(new TypeError("Cannot read properties of undefined (reading 'path')"));
    expect(failure.onGitHubsSide).toBe(false);
    expect(failure.message).toBe("Cannot read properties of undefined (reading 'path')");
  });
});
