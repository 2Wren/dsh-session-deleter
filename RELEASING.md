# Releasing

This repository publishes `dsh-session-deleter` to npm. Read the compatibility
rules in [CONTRIBUTING.md](CONTRIBUTING.md#pull-requests) before changing what
the plugin deletes.

## One-time setup

1. Create a free account at [npmjs.com](https://www.npmjs.com/signup) if you do
   not have one. An npm account is separate from GitHub; you can sign up with
   GitHub OAuth.
2. Verify the account's email address and enable two-factor authentication.
   Choose **Authorization and writes** (not just authorization): npm requires a
   second factor for publishing. If npm refuses the first publish with
   `403 ... Two-factor authentication or granular access token with bypass 2fa
   enabled is required`, see [Troubleshooting](#troubleshooting).
3. Check that the package name is still free:

   ```bash
   npm view dsh-session-deleter
   ```

   A `404` means the name is available. An existing package with that name
   cannot be published over; choose another name and update the manifest,
   the client factory id, the bundle patch, and both READMEs.

## First release

The first version cannot use trusted publishing, because npm cannot configure a
trusted publisher for a package that does not exist yet. Publish it from the
maintainer's machine:

```bash
npm login
npm test
npm publish --access public
```

Enter the one-time password when npm asks. This claims the package name and
publishes `1.0.0`.

Then register the GitHub workflow as the trusted publisher:

1. Open the package on npmjs.com → **Settings** → **Trusted Publisher**.
2. Choose **GitHub Actions** and fill in:
   - Organization or user: `2Wren`
   - Repository: `dsh-session-deleter`
   - Workflow filename: `publish.yml`
   - Environment: leave empty
   - Allowed action: `npm publish`
3. Save.

The repository's [publish workflow](.github/workflows/publish.yml) then
publishes future versions with a short-lived OIDC token and provenance — no
long-lived `NPM_TOKEN` secret is needed. The workflow upgrades npm first,
because trusted publishing requires npm `11.5.1` or newer.

## Later releases

1. Update `version` in `package.json` and add a `CHANGELOG.md` entry.
2. Run `npm test` and `npm pack --dry-run`.
3. Commit, then tag and push:

   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore: release v1.0.1"
   git tag v1.0.1
   git push origin main
   git push origin v1.0.1
   ```

   The tag push runs the publish workflow. It checks whether that exact version
   already exists on npm before publishing, so re-running a tag is harmless.

## Manual publishing

If the trusted publisher is unavailable (for example, publishing from a fork),
publish manually with `npm login` and `npm publish --access public`. Do not push
a release tag for a version that was already published manually unless the
workflow's existence check is present; it will skip the duplicate publish.

## Troubleshooting

### `403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required`

The account has no 2FA, or its 2FA mode does not cover writes. Pick one:

**A. Use 2FA at publish time (recommended).** On npmjs.com open the account menu
→ **Account Settings** → **Two-Factor Authentication** and choose
**Authorization and writes**. Then publish again:

```bash
npm publish --access public
# or, when npm does not prompt:
npm publish --access public --otp=123456
```

**B. Use a granular access token with 2FA bypass.** Enabling account 2FA is
still required. On npmjs.com → **Access Tokens** → **Generate New Token** →
**Granular Access Token**, grant **Read and write** for all packages, enable
**Bypass 2FA**, and pass the token for one command only:

```bash
read -s NPM_TOKEN        # paste the token, press Enter
npm publish --access public --//registry.npmjs.org/:_authToken="$NPM_TOKEN"
unset NPM_TOKEN
```

Never commit the token or paste it into an issue. npm is restricting bypass
tokens, so use trusted publishing for later releases.

### The package name is already taken

`npm view dsh-session-deleter` no longer returns `404`. Choose another name and
update `package.json`, the client factory id in `client.js`, the bundle patch,
and both READMEs.

## After publishing

- `npm view dsh-session-deleter version` confirms the published version.
- In DeepSeek Harness, install it through **Settings → Plugins → Add plugin**
  with `dsh-session-deleter`.
- Create a GitHub Release from the tag with the changelog text.
- Re-check the plugin against the DSH version in `engines.dsh` before widening
  that range.

## Compatibility policy

The plugin uses DeepSeek Harness internal APIs. Keep `engines.dsh` pinned to the
versions actually tested, and treat a DSH upgrade as a code change that needs
the test suite and a real deletion smoke test before release.
