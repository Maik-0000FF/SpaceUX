#!/usr/bin/env bash
# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Guard against drift between package.json and the lockfile the Nix package
# builds from. The repo root stays lockfile-free on purpose (.gitignore), so the
# only tracked lock is nix/package-lock.json, which nix/package.nix stages at the
# source root for buildNpmPackage's `npm ci`.
#
# Nothing else reads that file: every npm lane in CI runs `npm install` against
# the untracked root lock, so a dependency bump that edits package.json and
# forgets nix/package-lock.json passes CI and breaks only at `nix build`, where
# `npm ci` refuses a lock that no longer matches the manifest. This check moves
# that failure into CI.
#
# The verdict comes from npm itself rather than a hand-rolled JSON comparison,
# so it stays exactly as strict as the build it protects.
#
# No arguments; exits 0 when manifest and lock agree, non-zero otherwise. Runs
# in CI and by hand from anywhere in the checkout.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MANIFEST=package.json
LOCK=nix/package-lock.json

err() {
    printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2
}
ok() { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

for f in "$MANIFEST" "$LOCK"; do
    if [[ ! -f "$f" ]]; then
        err "$f not found"
        exit 1
    fi
done

# Stage the pair the same way nix/package.nix does (lock at the manifest's side)
# in a scratch directory, so the check never touches the checkout's own
# node_modules or the untracked root lock.
staged="$(mktemp -d)"
trap 'rm -rf "$staged"' EXIT
cp "$MANIFEST" "$staged/package.json"
cp "$LOCK" "$staged/package-lock.json"

# --dry-run so nothing is written; --ignore-scripts because the verdict needs
# only npm's manifest-vs-lock validation, not installed packages.
if ! output="$(cd "$staged" && npm ci --dry-run --ignore-scripts --no-audit --no-fund 2>&1)"; then
    err "$LOCK is out of sync with $MANIFEST"
    # npm appends its full `npm ci` usage block after the diagnosis; drop it so
    # the mismatch line stays the visible part of a failing lane.
    printf '%s\n' "$output" | sed '/^npm error Clean install a project/,$d' >&2
    printf '\n    Refresh it with:\n' >&2
    printf '      npm install --package-lock-only && cp package-lock.json %s\n' "$LOCK" >&2
    printf '    then update npmDepsHash in flake.nix:\n' >&2
    printf '      prefetch-npm-deps %s\n' "$LOCK" >&2
    exit 1
fi

ok "$LOCK is in sync with $MANIFEST"
