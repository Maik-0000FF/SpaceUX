# Contributing to SpaceUX

Thanks for contributing. This document describes the development setup and the
conventions used for issues and labels.

## Architecture at a glance

SpaceUX is composed of three layers, which the labels mirror:

- **daemon** — the C input layer (`src/daemon/`), reads the SpaceMouse device
  and speaks the IPC protocol.
- **main** — the Electron main process (`src/main/`): builtins, action exec,
  loaders.
- **renderer** — the React UI (`src/renderer/`) that draws the pie menu.

## Development setup

```sh
npm install
npm run build:all     # build the C daemon and the app
npm run dev           # vite dev server for the renderer
npm start             # launch the built Electron app
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
| `main`          | Electron main process: builtins, action exec, loaders |
| `renderer`      | Electron + React renderer                             |
| `ipc`           | Inter-process communication & sockets                 |
| `installer`     | Install / uninstall / packaging                       |
| `plugin-system` | Plugin manager & extension API                        |
| `ui/ux`         | User interface & interaction design                   |
| `theming`       | Pie menu appearance: shape, color, layout             |

### Priority — planning signal (apply at most one)

| Label              | Meaning               |
| ------------------ | --------------------- |
| `priority: high`   | Needs attention soon  |
| `priority: medium` | Normal priority       |
| `priority: low`    | Nice to have, no rush |

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
