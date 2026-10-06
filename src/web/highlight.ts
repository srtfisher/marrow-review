import { useEffect, useState } from 'react';
import type { DiffLine } from './lib/types.js';

export interface Token {
  content: string;
  style: Record<string, string>;
}

const EXT: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'jsx', php: 'php', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
  css: 'css', scss: 'scss', less: 'less', html: 'html', vue: 'vue', svelte: 'svelte', json: 'json', jsonc: 'jsonc',
  yml: 'yaml', yaml: 'yaml', md: 'markdown', mdx: 'mdx', sh: 'bash', bash: 'bash', zsh: 'bash', sql: 'sql', c: 'c',
  h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', xml: 'xml', toml: 'toml', twig: 'twig', graphql: 'graphql',
  dockerfile: 'docker', tf: 'hcl', lua: 'lua', ex: 'elixir', exs: 'elixir', dart: 'dart', scala: 'scala',
};

export function languageOf(path: string): string | null {
  const name = path.split('/').pop()!.toLowerCase();
  if (name === 'dockerfile') return 'docker';
  const ext = name.includes('.') ? name.split('.').pop()! : '';
  return EXT[ext] ?? null;
}

/**
 * Only the grammars marrow maps an extension to, each its own lazy chunk. The
 * full bundle is every language Shiki knows plus a WASM regex engine — eleven
 * megabytes for a page that mostly shows TypeScript and PHP.
 */
const LANGS: Record<string, () => Promise<{ default: unknown }>> = {
  bash: () => import('shiki/langs/bash.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  dart: () => import('shiki/langs/dart.mjs'),
  docker: () => import('shiki/langs/docker.mjs'),
  elixir: () => import('shiki/langs/elixir.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  hcl: () => import('shiki/langs/hcl.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  less: () => import('shiki/langs/less.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  mdx: () => import('shiki/langs/mdx.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  scala: () => import('shiki/langs/scala.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  twig: () => import('shiki/langs/twig.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
};

type Highlighter = Awaited<ReturnType<typeof import('shiki/core')['createHighlighterCore']>>;
let highlighter: Promise<Highlighter> | null = null;
const loaded = new Map<string, Promise<boolean>>();

async function ready(lang: string): Promise<Highlighter | null> {
  const load = LANGS[lang];
  if (!load) return null;
  highlighter ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript')]).then(([core, engine]) =>
    core.createHighlighterCore({
      themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
      langs: [],
      engine: engine.createJavaScriptRegexEngine(),
    }));
  const h = await highlighter;
  let ok = loaded.get(lang);
  if (!ok) {
    ok = load().then((m) => h.loadLanguage(m.default as never)).then(() => true, () => false);
    loaded.set(lang, ok);
  }
  return (await ok) ? h : null;
}

function tokenize(h: Highlighter, lang: string, lines: string[]): Token[][] {
  const result = h.codeToTokens(lines.join('\n'), {
    lang: lang as never,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  });
  return result.tokens.map((line) => line.map((t) => ({ content: t.content, style: (t.htmlStyle ?? {}) as Record<string, string> })));
}

/**
 * Tokens per diff line. The old side (context and removed lines) and the new
 * side (context and added lines) are each valid code on their own, so each is
 * highlighted whole; interleaving them would hand the grammar nonsense.
 */
export async function highlightHunk(path: string, lines: DiffLine[]): Promise<Array<Token[] | null> | null> {
  const lang = languageOf(path);
  if (!lang) return null;
  const h = await ready(lang);
  if (!h) return null;
  const oldIdx: number[] = [];
  const newIdx: number[] = [];
  lines.forEach((l, i) => {
    if (l.kind !== 'add') oldIdx.push(i);
    if (l.kind !== 'del') newIdx.push(i);
  });
  const oldTokens = tokenize(h, lang, oldIdx.map((i) => lines[i]!.text));
  const newTokens = tokenize(h, lang, newIdx.map((i) => lines[i]!.text));
  const out: Array<Token[] | null> = lines.map(() => null);
  oldIdx.forEach((i, j) => { out[i] = oldTokens[j] ?? null; });
  newIdx.forEach((i, j) => { out[i] = newTokens[j] ?? null; });
  return out;
}

export function useHighlight(path: string, lines: DiffLine[], enabled: boolean): Array<Token[] | null> | null {
  const [tokens, setTokens] = useState<Array<Token[] | null> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    highlightHunk(path, lines).then((t) => current && setTokens(t), () => {});
    return () => { current = false; };
  }, [path, lines, enabled]);
  return enabled ? tokens : null;
}
