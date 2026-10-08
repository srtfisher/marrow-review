# Lint PHP suggestions before submitting

**Date:** 2026-10-07
**Status:** approved design (reviewed in conversation), implemented
**Size:** small — one core module, a submit option, a dialog state

## Why

A suggestion block is posted exactly as written: the model's `suggestion` field, or the
fence the composer puts in the reviewer's own comment body. Nothing checks that the code
parses, alone or once it replaces the anchored lines. A suggestion that breaks the file is
worse than no suggestion, because one click on GitHub commits it.

## What was asked for

> "when making a suggestion for a php file can you verify that the suggestion and the php
> file's syntax are correct"
>
> "when submitting the review it should check then and alert you if it's not valid. if php
> isn't installed then it just skips it"

## Decisions

| Decision | Choice | Why |
|---|---|---|
| When | When the finish dialog opens, and again at submit before anything is sent | Asked for, in that order: the warning comes before the keypress. Submit checks again because the page is not the only client and `⌘↵` can beat the first check. |
| What | Every comment that will post on a `.php` file, `RIGHT` side: the `suggestion` field and every ```` ```suggestion ```` fence in the body | The reviewer's own suggestions live in the body; checking only the model's would miss half. |
| How | Put the suggestion in place of lines `startLine ?? line`…`line` of the head file, pipe it to `php -l` | Syntax of the file as it would be after the click, which is what breaks. Deterministic, no model. |
| File already broken | Lint the head file first; if it fails, skip that file | The pull request's code is at fault, not the suggestion. |
| On failure | The dialog lists each failure and offers **Submit anyway**; a plain submit sends nothing | Asked for. The reviewer may know better (a template, a partial file). |
| No `php`, a timeout, an unreadable file | Skip that check silently | Asked for, and a check that cannot run must never stop a review going out. |
| Seam | `SessionDeps.linter`, a `SyntaxLinter` (`handles(path)`, `lint(path, code)`), defaulting to `PHP_LINTER` | Tests and the e2e fixture never spawn `php`. Another language is another `SyntaxLinter`. |

## Shape

- `src/core/review/lint.ts`: `suggestionsOf(comment)`, `applySuggestion(text, comment, code)`,
  `PHP_LINTER` (the `php -l` runner, with `phpLintOutcome` reading its output), and
  `checkSuggestions(comments, readHead, linter)` returning `SyntaxProblem[]`.
- `ReviewSession.submit(verdict, body, { ignoreSyntax })` throws `SuggestionSyntaxError`
  carrying the problems unless `ignoreSyntax` is set.
- `ReviewSession.checkSuggestions()` behind `POST /sessions/:id/check`, called when
  `SubmitDialog` opens; a check that fails to run shows nothing.
- Submit answers `409 { error, problems }`. Either way the page lists the problems in
  `SubmitDialog` and the primary button becomes **Submit anyway**, which submits with
  `ignoreSyntax: true`.

## Not in scope

Other languages; suggestions on `LEFT` lines, which GitHub cannot apply.
