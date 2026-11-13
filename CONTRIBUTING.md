# Contributing

Thanks for taking the time to improve `dsh-session-deleter`.

## Ground rules

- This is a destructive plugin. A change must not make deletion easier to trigger
  accidentally, bypass the confirmation, or remove safety refusals.
- Keep the deleted scope explicit. If you change what is deleted or kept, update
  both `README.md` and `README.zh.md` and the confirmation copy in `client.js`.
- The plugin uses DeepSeek Harness internal APIs. State the DSH version you
  tested against in the pull request. Do not widen `engines.dsh` without
  verifying the new version's `sessionPersistence.stat()` location,
  `workspaceRegistry` accounting methods, `session_projcache` domain table, and
  Agent registry handle behavior.

## Development

Requirements: Node.js 22 or newer for the tests; a DeepSeek Harness checkout is
only needed to run the plugin inside the application.

```bash
npm test
npm run pack:check
```

There is no build step. `index.js` is the Host module and `client.js` is the
browser bundle loaded by the DeepSeek Harness module loader. The browser bundle
must keep its factory id equal to the package name.

### Install a local checkout

1. Open **Settings → Plugins** in DeepSeek Harness.
2. Choose **Add plugin** and enter this checkout's absolute path.
3. Restart DeepSeek Harness after changing Host code; the browser bundle is
   loaded from disk on the next page load.

### Tests

The test suite is self-contained and creates temporary Session-shaped
directories. It must never read or delete a real `~/.dsh` profile. Add a test
for every new refusal, path check, or rollback branch.

## Pull requests

- Keep the change focused; separate refactors from behavior changes.
- Describe the user-visible behavior and what remains unverified (for example,
  the rendered dialog when no browser control is available).
- Include the DSH version and operating system you tested.
- Confirm `npm test` and `npm run pack:check` pass.

## Reporting security issues

Do not open a public issue for a vulnerability that could delete data without a
user action. Contact the maintainer privately through the repository's security
advisory page.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
