#!/usr/bin/env bash
# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Generate the C header fragment of 046d SpaceMouse HID_ID patterns from the
# canonical data/spacemouse-046d-pids list. Run by CMake at build time (see
# CMakeLists.txt); the output is #included inside led_linux.c's DEVICE_PATTERNS
# initializer, so it is a bare list of string literals, not a standalone header
# (no include guard, no array wrapper — those live in led_linux.c).
#
# Usage: gen-pids-header.sh <input-data-file> <output-header>
set -euo pipefail

in=${1:?usage: gen-pids-header.sh <input-data-file> <output-header>}
out=${2:?usage: gen-pids-header.sh <input-data-file> <output-header>}

[[ -f $in ]] || {
    echo "gen-pids-header: input '$in' not found" >&2
    exit 1
}

mkdir -p "$(dirname "$out")"
tmp="$out.tmp"

{
    echo "/* Generated from data/spacemouse-046d-pids by scripts/gen-pids-header.sh."
    echo " * Do not edit — edit the data file. Included inside DEVICE_PATTERNS in led_linux.c. */"
    # HID_ID uevent strings are uppercase, zero-padded to 8 hex digits per field
    # ("0000046D:0000C626"); the data file stores lowercase 4-digit PIDs.
    awk '
        /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
        {
            pid = toupper($1)
            model = $2
            for (i = 3; i <= NF; i++) model = model " " $i
            printf "\t\"0000046D:0000%s\", /* %s */\n", pid, model
            count++
        }
        END {
            if (count == 0) {
                print "gen-pids-header: no PIDs parsed from data file" > "/dev/stderr"
                exit 1
            }
        }
    ' "$in"
} >"$tmp"

mv -f "$tmp" "$out"
