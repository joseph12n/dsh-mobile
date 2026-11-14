# Publishing the plugin on npm

This is the step-by-step for #12. It assumes you have never published a package. Nothing is
published by this change; the account, the scope and the version are your decision.

## What npm is, in one paragraph

npm is the public registry where JavaScript packages live. `pnpm publish` uploads a tarball
built from a package directory; users install it with `dsh` or `pnpm add`. A **scope** is the
`@name/` prefix: `@deepseekharness-mobile/companion` can only be published by the account or organization
that owns the `dsh-mobile` scope.

## What has to be published

- `@deepseekharness-mobile/companion`: the DSH plugin, including the PWA in `dist/web` and the bundle
  `cordis.patch.yml`. This is the package users install.
- `@deepseekharness-mobile/protocol`: the companion depends on it through `workspace:*`. `pnpm publish`
  rewrites that to the published version, so the protocol has to be published too (or bundled
  into the companion as a follow-up).

The app is embedded in the companion; it is not published on its own.

## Step 0 — decide three things

1. **Scope.** Does your npm account own `dsh-mobile`? Check <https://www.npmjs.com/org/dsh-mobile>.
   If it is free you can create the organization; if not, rename the three packages to a scope
   you own, for example `@your-user/dsh-mobile-companion`, and update the profile's bundle list
   and docs. This is the decision that blocks everything else.
2. **Version.** Start at `0.1.0`; all three packages move together while they are a workspace.
3. **Authentication.** For a first manual publish, `npm login` in this PC. For CI, a granular
   access token (Automation, Read and publish) stored as the `NPM_TOKEN` secret, or npm trusted
   publishing through GitHub Actions OIDC (no long-lived token). OIDC is the better default once
   the repository and the package are linked on npmjs.com.

## Step 1 — prepare the account

1. Create an account at <https://www.npmjs.com/signup> and verify the email.
2. Enable two-factor authentication (Profile → Settings → Two-factor authentication).
3. If you chose your own scope, create it from the npm menu **Organizations → Create** (a free
   organization is enough for public packages) and invite yourself.

## Step 2 — make the packages publishable

From the repository root, for `packages/protocol` and `packages/companion`:

- Remove `"private": true`.
- Set `"version": "0.1.0"` in both (the app can stay private).
- Check `package.json`: `main`/`exports` point at `dist`, `files` includes only `dist`,
  `cordis.patch.yml`, `README.md` and `LICENSE`; add `repository`, `homepage`, `bugs` and
  `publishConfig: { "access": "public" }`.
- Make sure `LICENSE` and a short `README.md` exist in each package; npm shows them on the page.
- Build and inspect the tarball:

```powershell
pnpm build
pnpm --filter @deepseekharness-mobile/protocol pack --dry-run
pnpm --filter @deepseekharness-mobile/companion pack --dry-run
```

The companion tarball must contain `dist/web/index.html` and the rest of the PWA (15 files under
`dist/web` at the time of writing).

## Step 3 — publish by hand (the first time)

```powershell
npm login
pnpm --filter @deepseekharness-mobile/protocol publish --access public --no-git-checks
pnpm --filter @deepseekharness-mobile/companion publish --access public --no-git-checks
```

- `--no-git-checks` lets pnpm publish from this branch; a release should normally be on a clean
  `main`.
- `--access public` is required for a scoped package the first time; otherwise npm treats it as
  private and asks for a paid plan.
- `pnpm publish` runs the build and rewrites `workspace:*` to the published version.
- Check the result at `https://www.npmjs.com/package/@deepseekharness-mobile/companion`.

To publish a fix, bump the version (`0.1.1`) and repeat. Versions are immutable: you cannot
overwrite a published version.

## Step 4 — automate it (after the first manual publish)

Add `.github/workflows/publish.yml` triggered by a tag `v*`:

```yaml
name: publish
on:
  push:
    tags: ['v*']
permissions:
  contents: read
  id-token: write
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm --filter @deepseekharness-mobile/protocol publish --access public --no-git-checks
      - run: pnpm --filter @deepseekharness-mobile/companion publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

With trusted publishing, remove `NODE_AUTH_TOKEN` and configure the GitHub repository as a
trusted publisher on the package page; the `id-token: write` permission is what npm verifies.
Keep the tarball smoke test (`pnpm smoke`) in the workflow before publishing.

## Step 5 — install it as a user

```powershell
dsh profile add @deepseekharness-mobile/companion
```

The profile reads the bundle's `cordis.patch.yml`, mounts the plugin and the embedded PWA. The
same pairing and tailnet steps from `docs/phone-setup.md` apply. Installing the package does not
restart a running DSH: the plugin loads at the next start.

## Checklist

- [ ] The scope is owned by you (or the packages are renamed).
- [ ] `private` removed from protocol and companion; versions set.
- [ ] `README`, `LICENSE`, `repository`, `publishConfig.access: public` in both.
- [ ] `pack()` shows `dist` and `dist/web` only, no sources, tests or local paths.
- [ ] First publish done by hand; a tag workflow added afterwards.
- [ ] `pnpm smoke` passes against the packed tarball.
