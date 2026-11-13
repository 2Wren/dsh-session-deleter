# dsh-session-deleter

[![npm version](https://img.shields.io/npm/v/dsh-session-deleter.svg)](https://www.npmjs.com/package/dsh-session-deleter)
[![CI](https://github.com/2Wren/dsh-session-deleter/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/2Wren/dsh-session-deleter/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/2Wren/dsh-session-deleter/blob/main/LICENSE)
![DSH 0.2.2-rc.2](https://img.shields.io/badge/DSH-0.2.2--rc.2-blue)

Permanently delete DeepSeek Harness conversations from the sidebar — ordinary
conversations and archived ones, with a confirmation step. This is an
unofficial community plugin, not affiliated with DeepSeek.

[中文说明](README.zh.md)

DeepSeek Harness can archive a conversation but has no delete action: archived
logs stay on disk forever. This plugin adds **Delete conversation permanently**
to the conversation row menu and removes the conversation's Session log and its
derived state from the profile.

## Features

- One destructive item in the shared conversation row menu (`…` or right-click),
  available for ordinary and archived conversations.
- A confirmation dialog with English and Chinese copy, focus trapping,
  Escape-to-close, and inline failure feedback.
- Immediate removal from the sidebar: an idle live Agent is closed before its
  files are removed, so the row does not linger as an "Ungrouped" ghost.
- Refuses a conversation that is running or still has reported work in progress
  (subagents, background jobs, scheduled reminders), including an archived one.
- Refuses to delete the conversation currently open in the main view; switch to
  another conversation first.
- Verifies the storage path against the Session id before deleting anything.
- Restores the temporary archive state when closing or removing the
  conversation fails.

## Requirements

- DeepSeek Harness `0.2.2-rc.2` with the Web GUI (the plugin declares
  `engines.dsh: ^0.2.2-rc.2`).
- No build step and no runtime dependencies.

## Install

### From npm

1. Open **Settings → Plugins** in DeepSeek Harness.
2. Choose **Add plugin**.
3. Enter `dsh-session-deleter` and confirm.
4. If DeepSeek Harness asks for a restart, restart it.

### From GitHub

Choose **Add plugin** and enter the repository URL:

```text
https://github.com/2Wren/dsh-session-deleter
```

### From a local checkout

Clone the repository and enter its absolute path in **Add plugin**, or use the
agent tool:

```text
plugin_manager install_bundle /absolute/path/to/dsh-session-deleter
```

Installing a local directory links it. Replacing an already-loaded copy
requires a restart.

## Usage

1. Open the sidebar conversation row's `…` menu, or right-click the row.
2. Choose **Delete conversation permanently**.
3. Confirm in the dialog.

Archived conversations are hidden by default. Switch the sidebar filter to
**All conversations (show archived)** or **Archived only** to reach them.

The row disappears immediately after a successful deletion. Deleting is final:
there is no undo and no recycle bin.

## What is deleted

- The Session's append-only log directory under the configured session
  persistence root, including every stored format generation and the
  `session.lock` file.
- The Session's projection-cache record.
- Its Workspace accounting, pin, and archive entry.

## What is kept

- Attachments are content-addressed and may be shared by other conversations,
  so they are left in place.
- The full-text Session search index is not rewritten; a profile that enables
  it may keep entries for the deleted conversation until the process restarts.
- The project directory itself and every other conversation.

## How it works

DeepSeek Harness exposes no Session deletion API, so the plugin performs the
operation carefully on the Host:

1. `POST /api/session.delete` runs on the authenticated, owner-only `/api`
   channel. It accepts `application/json` only and validates the Session id.
2. The Host asks `ctx.sessionPersistence.stat()` for the selected log file and
   checks that the file lives in exactly `<project>/<sessionId>/`; anything else
   is refused without touching the filesystem.
3. It asks the Workspace activity waterfall for running work, then archives the
   Session so the durable archive gate blocks new model steps.
4. The plugin keeps the Agent handle that the registry normally discards (by
   wrapping `ctx.agents.resume` / `create`) and disposes an idle live Agent.
   That removes the Session from the in-memory store and publishes the removal
   to the sidebar.
5. It removes the Session-owned directory, deletes the projection-cache record,
   and clears the Workspace accounting, pin, and archive entry.
6. Any failure after the temporary archive restores the previous archive state.

This relies on internal DeepSeek Harness APIs, not only on stable public
surfaces. The declared `engines.dsh` range is part of the contract: check the
plugin against a new DSH release before widening it.

## Limitations

- The conversation open in the main view cannot be deleted from its dialog; the
  button is disabled and the dialog explains why.
- A conversation opened before this plugin version loaded may not have a
  retained handle; its row can remain as an inert entry until DeepSeek Harness
  restarts, although the log files are already gone.
- Subagent conversations are refused; they are managed by their parent.
- Version-sensitive: a DSH upgrade can change the internal APIs this plugin
  uses. Pin the tested version and re-test before widening `engines.dsh`.

## Uninstall

Open **Settings → Plugins**, find `dsh-session-deleter`, and remove it. Removing
the plugin does not restore conversations it already deleted.

## Development

```bash
git clone https://github.com/2Wren/dsh-session-deleter.git
cd dsh-session-deleter
npm test          # Host, route, live-disposal, and browser-factory tests
npm run pack:check
```

The tests create temporary Session-shaped directories; they never touch the
real profile. There is no build step: `index.js` runs on the Host and `client.js`
is the browser bundle loaded by the DeepSeek Harness module loader.

To iterate inside DeepSeek Harness, install the checkout through **Add plugin**
with its absolute directory path, then restart when Host code changes.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the review checklist, and
[RELEASING.md](RELEASING.md) for the npm release process.

## License

[MIT](LICENSE). DeepSeek Harness is a separate project with its own license;
this repository contains no DeepSeek Harness source code.
