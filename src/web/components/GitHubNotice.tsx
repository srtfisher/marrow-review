import type { ReactNode } from 'react';
import type { GitHubProblem } from '../lib/types.js';

const STATUS_PAGE = 'https://www.githubstatus.com';

const link = 'font-medium text-accent hover:underline';

/** An error, and when GitHub is the cause, what GitHub itself says about it. */
export function GitHubNotice({ message, github, children }: { message: string; github: GitHubProblem | null; children?: ReactNode }) {
  const report = github?.report ?? null;
  return (
    <div role="alert" className="space-y-1.5 rounded-md border border-danger/40 bg-danger-subtle px-3 py-2 text-sm">
      <p className="text-danger">{message}</p>
      {github?.onGitHubsSide && (report && report.incidents.length + report.degraded.length > 0 ? (
        <div className="text-fg">
          <p>
            <span className="font-semibold">GitHub reports: {report.description}.</span>{' '}
            <a href={STATUS_PAGE} target="_blank" rel="noreferrer" className={link}>githubstatus.com</a>
          </p>
          {report.incidents.map((i) => (
            <p key={i.url + i.name}>
              <a href={i.url} target="_blank" rel="noreferrer" className={link}>{i.name}</a>
              {i.update && <span className="text-fg-muted"> — {i.update}</span>}
            </p>
          ))}
          {report.degraded.length > 0 && <p className="text-fg-muted">{report.degraded.join(' · ')}</p>}
        </div>
      ) : (
        <p className="text-fg">
          {report ? 'GitHub reports no incident right now, so this may be brief.' : 'This looks like trouble on GitHub’s side.'}{' '}
          <a href={STATUS_PAGE} target="_blank" rel="noreferrer" className={link}>Check githubstatus.com</a>
        </p>
      ))}
      {children}
      {github?.requestId && <p className="font-mono text-xs text-fg-muted">GitHub request {github.requestId}</p>}
    </div>
  );
}
