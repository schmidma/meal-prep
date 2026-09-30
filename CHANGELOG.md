# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-09-30

### Added

- Production OCI image with a non-root runtime and persistent data storage, compatible with Podman and Docker.
- CI image builds and production smoke tests, with versioned GHCR image publishing for releases.
- Development images tagged `main` and by commit, published after successful app checks and image smoke tests on each push to `main`, with a manual rebuild option.

## [0.1.0] - 2026-09-30

### Added

- Flexible meal agenda with configurable planning ranges and meal sections, desktop drag-and-drop, and mobile long-press planning.
- Cooking plans and leftovers with portion allocation, timing checks, and undo.
- Reusable recipes with ingredient identities and aliases, ingredient filters, photo uploads, and illustrated fallback images.
- Use-soon ingredients to guide recipe selection and a shared shopping list.
- Email-code sign-in, shared households, multiple owners, and revocable invitations.
- Automatic saving, shared-plan updates, conflict handling, and recovery of unsaved edits.
- English and German interfaces with personal language preferences.
- Self-hosting with SQLite storage and SMTP email delivery.
- Code, documentation, and original bundled artwork under AGPL-3.0-only.

[Unreleased]: https://github.com/schmidma/meal-prep/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/schmidma/meal-prep/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/schmidma/meal-prep/releases/tag/v0.1.0
