import type { ReviewPayload } from '../review/payload.js';

/** The slice of Octokit needed to submit, so tests can supply a fake. */
export interface ReviewSubmitter {
  rest: {
    pulls: {
      createReview(params: Record<string, unknown>): Promise<{
        data: { id: number; html_url: string };
      }>;
    };
  };
}

export async function submitReview(
  octokit: ReviewSubmitter,
  owner: string,
  repo: string,
  pull_number: number,
  payload: ReviewPayload,
): Promise<{ id: number; htmlUrl: string }> {
  const { data } = await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number,
    event: payload.event,
    body: payload.body,
    comments: payload.comments,
  });

  return { id: data.id, htmlUrl: data.html_url };
}
