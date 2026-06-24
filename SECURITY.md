<!--
SPDX-FileCopyrightText: Maik-0000FF
SPDX-License-Identifier: GPL-3.0-or-later
-->

# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security vulnerabilities.

Report them privately through GitHub: open the repository's **Security** tab
and click **Report a vulnerability** (GitHub private vulnerability reporting).
This keeps the report confidential until a fix is available.

When reporting, please include where possible:

- the affected component (daemon, core, overlay, editor, or a plugin) and version or commit,
- your distribution, desktop environment, and compositor (this project targets KDE Plasma on Wayland),
- steps to reproduce, and the impact you observed.

## Scope

SpaceUX is pre-alpha and maintained by a single developer, so responses are
best-effort. Reports are reviewed and triaged as time allows; please allow a
reasonable window before any public disclosure.

The components most relevant to security are the `spaceux` daemon (it reads the
input device via evdev and injects input via `/dev/uinput`) and the plugin
loader (plugins run with the core's privileges today; capability enforcement is
tracked in the issue backlog). Findings in these areas are especially welcome.

## Supported versions

Security fixes target the latest `main` and the most recent release. Older
pre-release builds are not maintained.
