# A Mac app around the server

**Date:** 2026-10-06
**Status:** approved design (reviewed in conversation), implemented
**Size:** small — a separate `desktop/` package, one pure page module, one hook in `Review.tsx`
**Depends on:** 2026-10-05-web-app-design.md

## Why

A review takes minutes, and the browser tab it runs in is one of thirty. You switch away,
forget it, and come back to a finished review ten minutes later — or check it every minute
before it is done. A window of its own, with a Dock icon and a notification when the
review lands, fixes both. `startServer()` was already written as the desktop-shell seam;
this is the shell.

## What was asked for

> "lets make an optional lightweight electron or something mac app that i can use to
> review. wrapper around the current server. lets also make a icon for this application"
>
> "ideally we can also send a notification when the review is in, too. this should all
> still work seamlessly on the non-app version (minus the notification)"
>
> "we'd like to use the claude code on the machine instead of having to bundle that. the
> app should gracefully handle a missing gh or claude and report that to the user."
>
> "i want the model passes config to persist to the app."
>
> "we need to build it and put it on github releases, too. we don't have a apple developer
> license to sign it"

Settled in discussion:

- **Electron**, over a native Swift/WKWebView wrapper. Electron 44 ships Node 24.21, which
  meets `engines`, so the app needs no Node install. The Swift wrapper would be ~1 MB but
  needs Node 24 and renders in Safari's engine, not the one the page is tested in.
- On launch, **the picker with no clone**, plus **File › Open Local Checkout…** to run
  inside a checkout so the checkout and worktree sources still work. First named "Open
  Clone", which read as opening a file; renamed, and the folder must be a git checkout.
- **The machine's Claude Code**, not the SDK's bundled 272 MB copy: the app went from
  638 MB to 369 MB, nearly all of it Electron.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Where it lives | `desktop/`, its own `package.json`; not in the npm package's `files` | Optional means a CLI user never downloads Electron. |
| How marrow runs | `utilityProcess.fork(dist/cli.js, ['--no-open'])`; read the `marrow: <url>` line | The CLI already owns token, octokit, caches and shutdown. Reusing it means the shell cannot drift from the CLI, and a crash in a review cannot take the window down. |
| Which build | Dev: the repo's `dist/`. Packaged: `dist/` staged with production deps into `Resources/marrow`, outside asar, the SDK's platform binary deleted | Staged from the manifest, not `package-lock.json`, which the repository does not maintain (bun.lock is the lock). |
| Claude Code | The shell finds `claude` on the login PATH or in `~/.local/bin`, `~/.claude/local`, and passes `--claude-path` | A new CLI flag, so the transport hands the SDK `pathToClaudeCodeExecutable`. A missing one still starts the server — every pass is additive — and the transport checks the path first, so the failure reads "install Claude Code", not the bundled-binary "reinstall marrow". |
| Missing Claude Code | One dialog per launch, with a link; the page's per-pass notes say the same | Asked for while the window is still hidden, the sheet was never drawn; it waits for `show`. |
| PATH | Ask the login shell for `$PATH` once, with a timeout; fall back to adding Homebrew's paths | An app opened from Finder gets `/usr/bin:/bin`, and `gh auth token` fails as "gh is not installed". |
| Startup failure | The window shows the CLI's stderr, URLs as links | "Run `gh auth login`" is the CLI's message already; the shell should not invent its own. A missing or signed-out `gh` lands here. |
| Port | Remembered; one retry on any port on `EADDRINUSE` | localStorage is per origin and the origin includes the port: a fresh port every launch forgot the theme every launch. |
| Passes | The page reports accepted changes through `window.marrowDesktop?.savePasses`; the shell replays them as `--no-<pass>` on the next start | The server keeps passes in memory, and the CLI's flags stay the only input; the browser flow is unchanged. |
| Links | Anything off the server's origin opens in the browser; the window never navigates away | A GitHub page inside the review window has no way back. |
| Notification source | The page, through `window.marrowDesktop?.notify` from a preload | The page already knows when findings land; the shell would otherwise have to parse the SSE stream itself. In a browser the global is absent and nothing happens — no permission prompt. |
| When it fires | Only on a transition of `findings.status` from `finding`/`verifying` to `done`/`failed` | A cached reopen goes straight to `done`; announcing it would be noise. |
| When it shows | Only when the window is not focused; a Dock badge until it is | If you are looking at the page, the page is the notification. |
| Signing | Ad-hoc, re-signed after packaging with the bundle id as identifier | No Developer ID. Packager leaves Electron's signature, identifier `Electron`, and macOS refuses notifications (`UNErrorDomain` 1) when it disagrees with the bundle id. Unnotarized, so the README gives the quarantine step. |
| Releases | `release.yml` builds arm64 and x64 zips on one macOS runner after npm publishes, and attaches them | Nothing staged is native once the SDK binary is gone, so cross-building is safe. |

## The notification

Title is the pull request: `#123 Rework the cache`. Body counts what the page will show:
`3 findings · 2 low confidence`, using the same score line as the Low confidence button;
`No findings` when there are none; `Review failed: <summary>` on failure. A click focuses
the window.

## The icon

The favicon's identity at Dock size: the purple `M` on a macOS squircle, with a vertical
gradient so it is not a flat swatch beside other apps, and three faint diff rows behind the
`M` so it reads as a code tool. Source is `desktop/assets/icon.svg`; `scripts/icon.sh`
renders every iconset size and builds `icon.icns`. The page's favicon stays as it is.

## Not in scope

Developer ID signing and notarization, auto-update, Windows and Linux builds, and a native PR
picker — the page's picker is the picker.

## Revision 2026-10-07: more than one window

File › New Window (⌘N) opens another window, so two pull requests can be reviewed side by
side. It needed no change below the shell: the server already keeps a session per pull
request, and the page keeps its review in the hash.

| Decision | Choice | Why |
|---|---|---|
| Servers | One, shared by every window | A server per window means a token, caches, and a port each, and only one of them could keep the remembered port the theme depends on. The checkout and the passes stay app-wide, as they already were. |
| A new window | Opens on the server's URL with no route, so the picker; offset from the window it was opened over | Exactly on top, it looks like nothing happened. |
| Restart, or a new checkout | Every window reloads on the new URL with the route it was on | Each comes back to its own review, and the draft is restored from disk. |
| Title | The page's title (`o/r#42 · marrow`), then the checkout's name | Every window called "marrow — clone" made the Window menu useless. |
| Notifications | From any window; skipped when that window is focused; a click focuses that window | The window that finished is the one you want. |
| Quitting | Closing the last window still quits | The server lives for the windows. |
