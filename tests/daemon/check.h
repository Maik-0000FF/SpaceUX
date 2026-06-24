/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * check - minimal assert-independent test harness for the C daemon.
 *
 * Plain assert() is compiled out under -DNDEBUG, which the default
 * Release build (CMAKE_BUILD_TYPE=Release) sets, so assert-based
 * checks would pass vacuously in a normal build. CHECK always
 * evaluates its condition, logs failures to stderr with file:line,
 * and accumulates into the counters so main() can return non-zero.
 *
 * The counters are file-local (static) on the assumption of a single
 * test translation unit per executable; split them into their own .c
 * if a future test links several units into one binary.
 */
#ifndef SPACEUX_TEST_CHECK_H
#define SPACEUX_TEST_CHECK_H

#include <stdio.h>

static int check_total;
static int check_failures;

#define CHECK(cond)                                                                                \
	do {                                                                                       \
		check_total++;                                                                     \
		if (!(cond)) {                                                                     \
			check_failures++;                                                          \
			fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);            \
		}                                                                                  \
	} while (0)

/* Print a one-line summary and return the process exit status: 0 when
 * every check passed, 1 otherwise. Call once at the end of main(). */
static int check_report(void)
{
	fprintf(stderr, "%d/%d checks passed\n", check_total - check_failures, check_total);
	return check_failures == 0 ? 0 : 1;
}

#endif /* SPACEUX_TEST_CHECK_H */
