# End-to-end tests for the page and the Mac app

**Date:** 2026-10-06
**Status:** approved design (reviewed in conversation), implemented
**Size:** small — one fixture server, two Playwright suites, two CI jobs
**Depends on:** 2026-10-06-desktop-shell-design.md

## Why

CI ran unit tests only. Nothing loaded the built page, and nothing launched the app, so a
bundle that throws on load, a preload that stops exposing `window.marrowDesktop`, or a
shell that never reads the `marrow:` line would all have passed.

## What was asked for

> "can we also add testing for the application as well as the existing web app to CI?"

## Decisions

| Decision | Choice | Why |
|---|---|---|
| What runs | The real `startServer()` and `dist/web`, over the session fakes the unit tests use (`tests/core/session/fixtures.ts`) | No GitHub and no model, as for every other test; the page and server under test are the shipped ones. |
| Fixture server | `e2e/fixture-server.ts`: the CLI's `parseArgs`, the CLI's `marrow:` line | The same contract as `dist/cli.js`, so the app runs it unchanged and `--no-<pass>` replay is exercised for real. |
| Find delay | One second | The notification fires on `finding` → `done`; an instant review arrives already done and fires nothing, correctly. |
| Under Electron | `desktop/e2e/fixture-cli.mjs` spawns bun | Electron's Node cannot run TypeScript, and bundling broke the fixtures' relative paths. |
| Test seams | `MARROW_DESKTOP_CLI`, `MARROW_DESKTOP_USER_DATA` | The fixture in place of marrow, settings that are not the developer's. A stub login shell puts a stub `claude` on PATH. |
| Runner | Playwright: Chromium for the page, `_electron` for the app | The standard for both; one assertion style. |
| Where | Web on Linux; the app on macOS | The Dock badge exists only on macOS, and the app ships only there. |
| `bun test` | `bunfig.toml` roots it at `tests/` | Bun runs `*.spec.ts` too, and would try the Playwright files. Desktop unit tests run in the desktop job. |

## What the suites check

The page: picker → review → diff and a scored finding; a pass switched off survives a
reload; no `marrowDesktop` and no console errors in a browser.

The app: the page loads with `notify` and `savePasses` bridged; a review landing in the
background badges the Dock; passes survive a relaunch; a failing CLI shows its message
with the link live; an external link goes to `shell.openExternal` and opens no window.

Each was checked against a deliberate break: a throw in `main.tsx` fails the console test,
and a renamed bridge fails the three that depend on it.
