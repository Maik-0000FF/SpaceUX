// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Hosts a {@link CoreService} as the `org.spaceux.Core` D-Bus service (the
 * `org.spaceux.Core1` interface) (#457 A2c). The dispatcher is generic: it
 * iterates `CORE_METHODS` and gives every
 * method the same uniform JSON-RPC shape (one `s` args string in, one `s`
 * result string out), so a method added to the contract is served automatically.
 * Signals are emitted through the returned handle.
 *
 * Wire (matches org.spaceux.Core1.xml): args = the logical argument tuple
 * JSON-encoded as an array string (empty array for no-arg methods); result =
 * the return value JSON-encoded (`null` for void). Signal payloads are JSON
 * strings, except `ActionsChanged` which carries none.
 */

import DBus from 'dbus-next';

import {
  CORE_INTERFACE,
  CORE_METHODS,
  CORE_OBJECT_PATH,
  CORE_SERVICE,
  CORE_SIGNALS,
  type CoreSignalName,
} from '../shared/core-contract.js';
import type { CoreService } from '../main/core-service.js';

/** Signals declared with no argument (see the XML); all others carry a JSON `s`. */
const PAYLOADLESS_SIGNALS: ReadonlySet<CoreSignalName> = new Set<CoreSignalName>([
  'ActionsChanged',
]);

class CoreInterface extends DBus.interface.Interface {
  constructor(public readonly service: CoreService) {
    super(CORE_INTERFACE);
  }
}

// One uniform method per contract member: decode the args array, call the
// service, JSON-encode the result (null for void). Added to the prototype before
// configureMembers so dbus-next picks them up.
for (const name of CORE_METHODS) {
  (CoreInterface.prototype as unknown as Record<string, unknown>)[name] = async function (
    this: CoreInterface,
    argsJson: string,
  ): Promise<string> {
    const args = (argsJson ? JSON.parse(argsJson) : []) as unknown[];
    const fn = this.service[name] as (...a: unknown[]) => unknown;
    const result = await fn.apply(this.service, args);
    return JSON.stringify(result ?? null);
  };
}

// In dbus-next a signal is a member that returns its payload; calling it emits.
for (const name of CORE_SIGNALS) {
  (CoreInterface.prototype as unknown as Record<string, unknown>)[name] = function (
    payload?: string,
  ): string | undefined {
    return payload;
  };
}

CoreInterface.configureMembers({
  methods: Object.fromEntries(
    CORE_METHODS.map((n) => [n, { inSignature: 's', outSignature: 's' }]),
  ),
  signals: Object.fromEntries(
    CORE_SIGNALS.map((n) => [n, { signature: PAYLOADLESS_SIGNALS.has(n) ? '' : 's' }]),
  ),
});

export interface CoreServerHandle {
  /** Emit a push signal. `payload` is JSON-encoded here; omit it for the
   *  payloadless `ActionsChanged`. */
  emit(signal: CoreSignalName, payload?: unknown): void;
  /** Release the bus name and disconnect (best effort). */
  stop(): Promise<void>;
}

/**
 * Try to claim `org.spaceux.Core` on the session bus. Returns the owning bus
 * connection, or null when another core already holds the name, which is the
 * single-instance check (#415): the host probes this FIRST, before the daemon,
 * watchers or runtime exist, so a second launch can bail out without spinning
 * anything up. DO_NOT_QUEUE + assert primary ownership, so we never silently
 * export onto a name another process owns.
 */
export async function claimCoreBusName(): Promise<DBus.MessageBus | null> {
  const bus = DBus.sessionBus();
  const reply = await bus.requestName(CORE_SERVICE, DBus.NameFlag.DO_NOT_QUEUE);
  if (reply !== DBus.RequestNameReply.PRIMARY_OWNER) {
    bus.disconnect();
    return null;
  }
  return bus;
}

/** Export the service on a bus that already owns the core name (the second
 *  half of {@link startCoreServer}, for a host that claimed early). */
export function exportCoreService(bus: DBus.MessageBus, service: CoreService): CoreServerHandle {
  const iface = new CoreInterface(service);
  bus.export(CORE_OBJECT_PATH, iface);

  const signalMembers = iface as unknown as Record<CoreSignalName, (payload?: string) => unknown>;
  return {
    emit(signal, payload) {
      if (PAYLOADLESS_SIGNALS.has(signal)) signalMembers[signal]();
      else signalMembers[signal](JSON.stringify(payload ?? null));
    },
    async stop() {
      try {
        await bus.releaseName(CORE_SERVICE);
      } catch {
        // already gone; disconnect anyway
      }
      bus.disconnect();
    },
  };
}

/** Claim the name and export in one step. Throws when another instance owns
 *  the name (integration tests assert the loud failure; the host uses the
 *  split claim/export so a second launch can react before building anything). */
export async function startCoreServer(service: CoreService): Promise<CoreServerHandle> {
  const bus = await claimCoreBusName();
  if (bus === null) throw new Error(`${CORE_SERVICE} is already owned`);
  return exportCoreService(bus, service);
}
