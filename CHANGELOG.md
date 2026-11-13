# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-13

### Added

- A **Delete conversation permanently** action in the conversation row menu,
  available for ordinary and archived conversations.
- A confirmation dialog with localized English and Chinese copy, keyboard
  focus handling, Escape-to-close, and inline failure feedback.
- Immediate removal from the sidebar: the plugin retains the Agent handle the
  registry normally discards, closes an idle live Agent before deleting its
  files, and lets the Host publish the Session removal.
- Refusals with reasons for running turns and reported background work
  (subagents, jobs, scheduled reminders), including already-archived sessions.
- Verification of the reported storage location before any file removal.
- Removal of the projection-cache record, Workspace accounting, pin, and
  archive entry alongside the Session log directory.
- Transactional behavior: archive state is restored when closing or removing
  the conversation fails.
- Standalone tests for the Host operation, the HTTP route, live-Agent disposal,
  and the browser factory.
- GitHub Actions CI and an npm trusted-publishing workflow.
