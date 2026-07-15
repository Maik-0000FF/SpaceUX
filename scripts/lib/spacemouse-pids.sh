# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
# shellcheck shell=bash
#
# Shared helper, meant to be sourced (not run). Turns the single-source PID list
# data/spacemouse-046d-pids into the udev/regex alternation the consumers need,
# so the parse lives in exactly one place. Sourced by scripts/install.sh (which
# writes the udev rules) and scripts/check-rule-consistency.sh (which verifies
# the hand-copied literals in docs and nix against it). Defining a function only,
# it has no side effects on source.

# Emit the 046d SpaceMouse PID alternation (c603|c605|...|c640) parsed from the
# file given as $1: comment and blank lines dropped, first field per line,
# pipe-joined. Empty output means nothing parsed.
spacemouse_046d_pid_alternation() {
	awk '!/^[[:space:]]*#/ && NF { printf "%s%s", sep, $1; sep="|" }' "$1"
}
