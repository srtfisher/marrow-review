import { useEffect, useState } from 'react';
import { api, type AppInfo } from './api.js';
import { Picker } from './components/Picker.js';
import { Review, type SubmittedReview } from './components/Review.js';
import { useTheme } from './hooks.js';
import { parseRoute } from './lib/format.js';
import { pullKey, type Reviewed } from './lib/reviewed.js';

export function App() {
  const [theme, cycleTheme] = useTheme();
  const [app, setApp] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState(window.location.hash);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [repo, setRepo] = useState<{ owner: string; repo: string } | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedReview | null>(null);
  const [reviewed, setReviewed] = useState<Reviewed>(new Map());

  useEffect(() => {
    api.app().then((info) => {
      setApp(info);
      setRepo(info.repo);
      // Started with a pull request: open straight into it.
      if (info.initial && !window.location.hash) window.location.hash = `#/${info.initial.owner}/${info.initial.repo}/${info.initial.number}`;
    }, (e: Error) => setError(e.message));
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const route = parseRoute(hash);
  useEffect(() => {
    if (route.owner && route.repo && route.number === null) setRepo({ owner: route.owner, repo: route.repo });
    if (!route.owner || !route.repo || route.number === null) { setSessionId(null); return; }
    let current = true;
    setRepo({ owner: route.owner, repo: route.repo });
    api.open(route.owner, route.repo, route.number).then(({ id }) => current && setSessionId(id), (e: Error) => current && setError(e.message));
    return () => { current = false; };
  }, [route.owner, route.repo, route.number]);

  useEffect(() => {
    document.title = route.number !== null ? `#${route.number} · marrow` : 'marrow';
  }, [route.number]);

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24">
        <p className="rounded-md border border-danger/40 bg-danger-subtle px-4 py-3 text-danger">{error}</p>
        <button type="button" className="mt-4 text-sm text-accent underline" onClick={() => { setError(null); window.location.hash = '#/'; }}>Back to pull requests</button>
      </div>
    );
  }
  if (!app) return <div className="flex h-full items-center justify-center text-fg-muted">Starting…</div>;

  const home = () => { window.location.hash = repo ? `#/${repo.owner}/${repo.repo}` : '#/'; };

  if (route.number !== null && sessionId) {
    return <Review key={sessionId} sessionId={sessionId} viewer={app.viewer} theme={theme} onTheme={cycleTheme} onHome={home} onReviewed={(owner, name, number) => setReviewed((m) => new Map(m).set(pullKey(owner, name, number), Date.now()))} onSubmitted={(r) => { setSubmitted(r); home(); }} />;
  }
  if (route.number !== null) return <div className="flex h-full items-center justify-center text-fg-muted">Opening #{route.number}…</div>;

  return (
    <Picker
      app={app}
      repo={repo}
      submitted={submitted}
      reviewed={reviewed}
      onDismiss={() => setSubmitted(null)}
      onOpen={(owner, name, number) => { setSubmitted(null); window.location.hash = `#/${owner}/${name}/${number}`; }}
      onRepo={(owner, name) => { window.location.hash = `#/${owner}/${name}`; }}
    />
  );
}
