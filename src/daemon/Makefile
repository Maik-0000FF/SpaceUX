# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
#
# spaceux-daemon: standalone C daemon that reads a 3Dconnexion puck
# from /dev/input and forwards events to subscribed clients over a
# UNIX socket. No external dependencies beyond libc + Linux evdev.

CC ?= gcc
CFLAGS ?= -Wall -Wextra -Wpedantic -O2 -std=gnu11
EXTRA_CFLAGS ?=
EXTRA_LDFLAGS ?=

TARGET = spaceux-daemon
OBJS = daemon.o kernel_input.o protocol.o socket.o

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CC) $(CFLAGS) $(EXTRA_CFLAGS) -o $@ $(OBJS) $(EXTRA_LDFLAGS)

%.o: %.c
	$(CC) $(CFLAGS) $(EXTRA_CFLAGS) -c -o $@ $<

daemon.o: daemon.c config.h kernel_input.h socket.h
kernel_input.o: kernel_input.c kernel_input.h config.h
protocol.o: protocol.c protocol.h config.h
socket.o: socket.c socket.h protocol.h config.h

clean:
	rm -f $(TARGET) $(OBJS)

.PHONY: all clean
