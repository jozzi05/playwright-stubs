# Release guide

This repo uses a two-stage release flow: **Prepare release** (manual) → PR to `main` → **Publish release** (automatic on merge).

## Branch model

| Branch | Purpose |
|--------|---------|
| `dev` | Default branch; day-to-day development |
| `main` | Release branch; tags and npm publishes land here |

## One-time setup checklist

### 1. GitHub repository

- [ ] Default branch is **`dev`**
- [ ] **`main`** branch protection: require PR, no force-push
- [ ] After CI has run once on `main`, enable required status check **`test`**
- [ ] Environment **`npm`**: required reviewer `jozzi05`, deployment branches `main` only (optional)

### 2. npm account

- [ ] Log in at [npmjs.com](https://www.npmjs.com) with 2FA enabled
- [ ] Confirm package name `playwright-stubs` is available

### 3. Baseline tag on `main`

Seed git-cliff with a starting tag (if not already done):

```bash
git checkout main
git tag v0.1.0
git push origin v0.1.0
```

### 4. npm Trusted Publisher (after first publish)

Trusted publishing is configured **per package**, only after the package exists on npm.

1. Go to **npmjs.com → Packages → `playwright-stubs` → Settings**
2. **Trusted publishing → GitHub Actions**
3. Fill in:
   - Organization or user: `jozzi05`
   - Repository: `playwright-stubs`
   - Workflow filename: `publish-release.yml`
   - Environment name: `npm`
4. Save

**Before the first CI publish:** either configure Trusted Publisher right after workflows land on `main`, or do one manual `npm publish --access public` locally to create the package, then add Trusted Publisher.

No `NPM_TOKEN` secret is needed when OIDC is configured.

**Requirements:** npm CLI ≥ 11.5.1, Node ≥ 22.14, workflow `permissions: id-token: write`.

## Day-to-day release

1. Merge features into **`dev`** using [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `feat!:` for breaking changes).
2. **Actions → Prepare release → Run workflow** (defaults to `dev`; only `jozzi05` can run it).
3. Review the PR **`release/*` → `main`** (release notes in PR body; `CHANGELOG.md` and version bump in the commit).
4. Merge the PR after CI passes.
5. **Publish release** workflow runs automatically:
   - Creates tag + GitHub Release
   - Opens/auto-merges back-merge PR **`main` → `dev`**
   - Waits for approval on the **`npm`** environment
6. In Actions, **Review deployments → Approve** to publish to npm with provenance.

## Version bump rules (git-cliff)

| Commit prefix | Bump |
|---------------|------|
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` or `BREAKING CHANGE:` | major |

`chore(release):` and merge commits are excluded from the changelog.

## Security layers

1. **Prepare release** — only `jozzi05` can trigger (`github.actor` check)
2. **`main` branch protection** — PR required before merge
3. **Publish workflow** — only runs for merged `release/*` PRs
4. **GitHub Environment `npm`** — manual approval before publish
5. **npm OIDC Trusted Publisher** — scoped to this repo + workflow; no long-lived token in secrets
