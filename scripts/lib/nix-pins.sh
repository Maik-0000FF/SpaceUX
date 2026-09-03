# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
# shellcheck shell=bash
# Every definition here is read by the sourcing script, never by this file, so
# the unused-variable warning would fire on all of them.
# shellcheck disable=SC2034
#
# Shared helper, meant to be sourced (not run). Names the tracked files that pin
# the npm half of the Nix build, and the tool that refreshes them, so the two
# checks guarding that half agree on what they are talking about. Sourced by
# scripts/check-npm-lock-sync.sh (manifest against lock) and
# scripts/check-npm-deps-hash.sh (lock against the hash over it). Both print the
# same refresh command, and renaming either file would otherwise have to be
# found in two places. Sourcing it defines variables and nothing else.
#
# The paths are relative to the repository root, which every consumer cd's into
# before reading them.

# The only tracked lockfile. The repo root stays lockfile-free on purpose, and
# nix/package.nix stages this one at the source root for buildNpmPackage.
NIX_LOCK=nix/package-lock.json

# Where the hash over that lockfile's fetched dependency tree is written by
# hand, and under which name.
NIX_FLAKE=flake.nix
NIX_HASH_FIELD=npmDepsHash

# The nixpkgs tool that computes the hash's value from the lockfile.
NIX_PREFETCH=prefetch-npm-deps
