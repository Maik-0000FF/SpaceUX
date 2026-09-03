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
# so it stays exactly as strict as the build it protects. Two consequences of
# borrowing npm's verdict are worth knowing:
#
#   * The check is one-directional, and it asks only what `npm ci` asks: does
#     the locked version still satisfy the manifest. An added dependency or a
#     range the lock no longer satisfies fails; a range merely widened around
#     the locked version passes, and so does a dependency deleted from
#     package.json, which `npm ci` prunes from the tree instead of refusing.
#     That stale entry keeps feeding npmDepsHash until the lock is regenerated
#     for another reason.
#   * Only the passing run is offline. Reaching any drift verdict needs the
#     registry: on a cold cache npm fetches the drifted package's metadata
#     before it compares, so an unreachable registry fails as ECONNREFUSED and
#     never gets as far as EUSAGE. The gate below then reports that as an
#     unrelated npm error on exactly the run where the lock is at fault. Under
#     the egress-audit policy the lanes use today that cannot happen; a block
#     policy would have to allow the registry.
#
# No arguments. Exits 0 when manifest and lock agree, 1 on drift, 2 when npm
# failed for an unrelated reason. Runs in CI and by hand from anywhere in the
# checkout.

set -euo pipefail

# BASH_SOURCE holds the path the script was invoked by, which is not necessarily
# a path to the script itself: for a symlink pointing into the checkout it names
# the link, and the shared libraries below would be looked for beside that link.
# readlink -f resolves it to the real file, once, for everything that follows.
SELF="$(readlink -f "${BASH_SOURCE[0]}")"
ROOT="$(cd "$(dirname "$SELF")/.." && pwd)"
cd "$ROOT"

# err/ok come from the shared logger, so this lane's output matches the other
# scripts' and the styling lives in one place.
# shellcheck source=scripts/lib/log.sh
. "$ROOT/scripts/lib/log.sh"
# The tracked files this guards are named in one place, shared with the other
# npm check, so a rename cannot leave one of them behind.
# shellcheck source=scripts/lib/nix-pins.sh
. "$ROOT/scripts/lib/nix-pins.sh"

MANIFEST=package.json

for f in "$MANIFEST" "$NIX_LOCK"; do
    if [[ ! -f "$f" ]]; then
        err "$f not found"
        exit 2
    fi
done

# Stage the pair the same way nix/package.nix does (lock at the manifest's side)
# in a scratch directory, so the check never touches the checkout's own
# node_modules or the untracked root lock.
staged="$(mktemp -d)"
trap 'rm -rf "$staged"' EXIT
cp "$MANIFEST" "$staged/package.json"
cp "$NIX_LOCK" "$staged/package-lock.json"
# nix/package.nix stages the whole tree, so npm reads a repo-level .npmrc there.
# There is none today, but adding one (legacy-peer-deps, a registry override)
# would change how npm resolves and this run would stop matching the build it
# stands in for.
NPMRC=.npmrc
if [[ -f "$NPMRC" ]]; then
    cp "$NPMRC" "$staged/$NPMRC"
fi

# --dry-run so nothing is written; --ignore-scripts because the verdict needs
# only npm's manifest-vs-lock validation, not installed packages.
#
# --loglevel=error and --no-color pin the one thing the verdict below reads:
# the text of npm's diagnosis. It is matched literally, so both of the caller's
# switches that reshape it would break the match and turn real drift into an
# unrelated-error exit. A quiet loglevel in ~/.npmrc prints no diagnosis at all;
# colour splits `code EUSAGE` with an escape sequence in the middle. A command
# line beats the user config and the environment, so this holds however npm is
# configured. Both shape the output only, never the resolution, which is why
# neither has a counterpart in the npmFlags below.
#
# Nothing else is passed: any flag that shapes resolution would have to be kept
# in step with the npmFlags in nix/package.nix by hand, and this run has to
# resolve the way that build does.
status=0
output="$(cd "$staged" && npm ci --dry-run --ignore-scripts --loglevel=error --no-color 2>&1)" || status=$?

if [[ $status -eq 0 ]]; then
    ok "$NIX_LOCK is in sync with $MANIFEST"
    exit 0
fi

# Only a manifest-vs-lock mismatch counts as drift. An unreachable registry, a
# missing npm or a version that no longer exists all fail too, and none of them
# is an answer about the lock; reporting them as drift would send someone off to
# regenerate a lockfile that is already correct. Some of them are not about the
# lock but still real, a manifest pinning a version npm cannot resolve among
# them, so the branch below says only that no verdict was reached and prints
# npm's own diagnosis untrimmed rather than naming a culprit.
#
# EUSAGE alone is not that signal: it is npm's generic usage code, and a wholly
# absent lockfile raises it just as well. So the sentence npm reserves for the
# mismatch has to be there too. Both matched loosely, because npm prefixes its
# diagnostics with `npm error` since 10 and `npm ERR!` before that.
DRIFT_MESSAGE='can only install packages when your package.json and package-lock.json'
if ! grep -q 'code EUSAGE' <<<"$output" || ! grep -qF "$DRIFT_MESSAGE" <<<"$output"; then
    err "npm ci failed before it could compare $MANIFEST and $NIX_LOCK"
    printf '%s\n' "$output" >&2
    exit 2
fi

err "$NIX_LOCK is out of sync with $MANIFEST"
# npm appends its full `npm ci` usage block after the diagnosis; drop it so the
# mismatch line stays the visible part of a failing lane. Anchored on the usage
# header's text alone, matching the EUSAGE grep above, so the trim survives the
# `npm error` / `npm ERR!` prefix change and does not silently stop working.
printf '%s\n' "$output" | sed '/Clean install a project/,$d' >&2
# Seed the root lock from the tracked one first. Without that seed the refresh
# starts from whatever untracked lock the working copy happens to hold (or from
# nothing at all in a fresh clone) and npm re-resolves the whole tree, which
# turns a one-line bump into a wholesale lockfile rewrite and pulls untested
# versions into the Nix build.
#
# The paths are repo-relative and the heading says so, rather than printing this
# checkout's location: the line is read as often from a CI log, where that path
# names a runner nobody can cd into. The steps are chained so a wrong working
# directory stops the sequence at the failing cp. Unchained, the seeding cp
# fails while `npm install` still finds the manifest by walking up and resolves
# the whole tree unseeded, which is the rewrite warned about above.
printf '\n    Refresh it, from the repository root, with:\n' >&2
printf '      cp %s package-lock.json &&\n' "$NIX_LOCK" >&2
printf '        npm install --package-lock-only &&\n' >&2
printf '        cp package-lock.json %s\n' "$NIX_LOCK" >&2
printf '    (this replaces the untracked root package-lock.json)\n' >&2
printf '    then update %s in %s:\n' "$NIX_HASH_FIELD" "$NIX_FLAKE" >&2
printf '      %s %s\n' "$NIX_PREFETCH" "$NIX_LOCK" >&2
exit 1
