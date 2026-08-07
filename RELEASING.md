# Releasing

Releases are **tag-driven**. Pushing a `v*` tag triggers
`.github/workflows/release.yml`, which runs the suite, publishes to npm via
**trusted publishing (OIDC)** — no token — and creates the GitHub release from
the matching `CHANGELOG.md` section. Provenance is generated automatically.

The package is `marrow-review`; the binary it installs is `marrow`.

## One-time setup

Trusted publishing is configured per-package, so the package must exist first.

1. **First publish, by hand** (also creates the package on npm):

   ```bash
   npm login
   npm publish
   ```

   `publishConfig.access` is already `public`, so no flag is needed.

2. **Configure the trusted publisher** on npmjs.com → the package →
   _Settings → Trusted Publishing → Add_:
   - Provider: **GitHub Actions**
   - Repository: `srtfisher/marrow-review`
   - Workflow filename: `release.yml`

That's it — no `NPM_TOKEN` secret. The release workflow already requests the
`id-token: write` permission OIDC needs, and GitHub's built-in token creates the
release.

## Cutting a release

1. Add a section to `CHANGELOG.md` for the new version, e.g.:

   ```markdown
   ## [0.2.0] - 2026-09-01

   ### Added
   - ...
   ```

2. Update `src/core/version.ts` to the new number. `npm version` does not touch
   it, and `tests/version.test.ts` fails if it drifts from `package.json`.

3. Commit both:

   ```bash
   git commit -am "Changelog and version for 0.2.0"
   ```

4. Bump, which tags and pushes (pick the matching bump):

   ```bash
   npm run release:minor   # 0.1.0 -> 0.2.0  (also: release:patch / release:major)
   ```

`npm version` bumps `package.json`, commits, and creates the `vX.Y.Z` tag;
`--follow-tags` pushes it. CI takes over from there.

> Keep the CHANGELOG heading, `src/core/version.ts`, and the bump in sync — the
> release notes are extracted from the `## [x.y.z]` heading, and the version test
> gates the rest.
