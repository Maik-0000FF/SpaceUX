<!--
SPDX-FileCopyrightText: Maik-0000FF
SPDX-License-Identifier: GPL-3.0-or-later
-->

# Contributing to SpaceUX

Thanks for contributing. This document describes the development setup and the
conventions used for issues and labels.

## Architecture at a glance

SpaceUX is composed of four layers, which the labels mirror:

- **daemon** — the C input layer (`src/daemon/`), reads the SpaceMouse device
  and speaks the IPC protocol.
- **core** — the Node service (`src/core-host/` entrypoint over `src/main/`,
  `src/core/` and `src/shared/`): owns config, plugins, actions, the pie
  runtime and desktop mode, and serves the editor as `org.spaceux.Core` on the
  session bus (labels: `main`).
- **editor** — the native Qt6/QML editor (`src/editor-qt/`), a D-Bus client of
  the core (labels: `renderer`).
- **overlay** — the native Wayland overlay (`src/overlay/`), a
  Qt6/QML/LayerShellQt daemon that renders the pie as an SVG, driven by the
  core over D-Bus; the pie renderer it shares with the editor lives in
  `src/qt-shared/`.

## Development setup

```sh
npm install
npm run build                                  # the TypeScript core -> dist/
cmake -S . -B build -DSPACEUX_BUILD_UI=ON      # configure daemon + overlay + editor
cmake --build build                            # build them
npm start               # run the core (org.spaceux.Core on the session bus)
./build/spaceux-editor  # open the editor, a D-Bus client of the core
```

Before opening a pull request:

```sh
npm test              # vitest
npm run format:check  # prettier (CI enforces this)
```

Run `npm run format` to fix formatting.

## Issue labels

Labels are grouped along four axes. Aim to apply one from each axis that
applies — at minimum a **type** and an **area**.

### Type — what kind of work (apply exactly one)

| Label           | Meaning                              |
| --------------- | ------------------------------------ |
| `bug`           | Something isn't working              |
| `regression`    | Worked before, broke after a change  |
| `enhancement`   | New feature or request               |
| `refactor`      | Code change without behavior change  |
| `performance`   | Speed, memory or latency improvement |
| `security`      | Security-relevant issue or hardening |
| `documentation` | Documentation improvements           |
| `test`          | Test coverage / test infrastructure  |

### Area — which part of the system (apply one or more)

| Label           | Meaning                                               |
| --------------- | ----------------------------------------------------- |
| `daemon`        | C daemon / input layer                                |
| `main`          | Node core: builtins, action exec, loaders, runtime    |
| `renderer`      | Qt6/QML editor UI                                     |
| `overlay`       | Native Wayland overlay daemon (src/overlay) + SVG pie |
| `ipc`           | Inter-process communication & sockets                 |
| `installer`     | Install / uninstall / packaging                       |
| `ci`            | Build / CI pipeline & tooling                         |
| `plugin-system` | Plugin manager & extension API                        |
| `ui/ux`         | User interface & interaction design                   |
| `theming`       | Pie menu appearance: shape, color, layout             |

### Priority — planning signal (apply at most one)

| Label              | Meaning                    |
| ------------------ | -------------------------- |
| `priority: high`   | Needs attention soon       |
| `priority: medium` | Normal priority            |
| `priority: low`    | Not urgent, but to be done |

`nice-to-have` is separate from the priority ladder: it marks optional work that
need not be done at all, unlike `priority: low` (not urgent, but still to be
done). Apply it instead of a priority, not alongside one.

### Status — workflow state (apply as needed)

| Label                 | Meaning                                   |
| --------------------- | ----------------------------------------- |
| `blocked`             | Blocked by another issue or dependency    |
| `needs-investigation` | Cause unclear, requires analysis          |
| `needs-testing`       | Fix in place, needs to be tested/verified |
| `awaiting-user`       | Waiting for confirmation from the user    |

### Labeling rules

- Apply a **type** and at least one **area** to every issue.
- Add multiple areas when an issue spans layers (e.g. an installer change that
  affects the daemon gets both `installer` and `daemon`).
- Add `ui/ux` alongside `bug`/`enhancement` whenever the pie interaction is
  visibly affected.
- Apply a **priority** only to open issues; it carries no meaning on closed ones.
- If no area label fits, leave the area off rather than forcing one.

Labels can be edited at any time (`gh label edit <name> --name/--color/--description`);
renames preserve existing assignments, so the scheme can evolve without losing history.
